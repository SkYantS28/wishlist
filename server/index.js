import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { rateLimit } from 'express-rate-limit';
import { Prisma, PrismaClient } from '@prisma/client';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { getPreviewAllowedHosts, getProductImage } from './preview.js';

const prisma = new PrismaClient();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const PgSession = connectPgSimple(session);
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;
const sessionMaxAge = 7 * 24 * 60 * 60 * 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const previewAllowedHosts = getPreviewAllowedHosts();
const smtpHost = process.env.SMTP_HOST;
const smtpFrom = process.env.SMTP_FROM;
const smtpUser = process.env.SMTP_USER;
const smtpPassword = process.env.SMTP_PASSWORD;
const smtpTransport = smtpHost && smtpFrom && smtpUser && smtpPassword
  ? nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: smtpUser, pass: smtpPassword },
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  : null;
const appUrl = new URL(process.env.APP_URL || 'http://localhost:5173');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured.');
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters.');
}
if (!['http:', 'https:'].includes(appUrl.protocol) || appUrl.username || appUrl.password || (isProduction && appUrl.protocol !== 'https:')) {
  throw new Error('APP_URL must be a public HTTP URL; use HTTPS in production.');
}

if (isProduction) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: { imgSrc: ["'self'", 'data:', 'http:', 'https:'] },
  },
}));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'wishly.sid',
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15,
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: sessionMaxAge,
  },
}));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
  profileVisibility: true,
  avatarMime: true,
  avatarUpdatedAt: true,
  createdAt: true,
  _count: {
    select: {
      followers: { where: { status: 'accepted' } },
      following: { where: { status: 'accepted' } },
      lists: { where: { visibility: 'public' } },
    },
  },
};

function initials(displayName) {
  return displayName.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
}

function serializeUser(user, includePrivate = false) {
  return {
    id: user.id,
    username: user.username,
    name: user.displayName,
    avatar: initials(user.displayName),
    bio: user.bio,
    visibility: user.profileVisibility,
    avatarUrl: user.avatarMime ? `/api/users/${user.id}/avatar?v=${user.avatarUpdatedAt?.getTime() || 0}` : null,
    ...(includePrivate ? { email: user.email } : {}),
    followersCount: user._count?.followers ?? undefined,
    followingCount: user._count?.following ?? undefined,
    listsCount: user._count?.lists ?? undefined,
  };
}

function isDirectImage(url) {
  return /\.(jpe?g|png|gif|webp|avif)(\?.*)?$/i.test(url);
}

function serializeItem(item, { isOwner = false, reserved = false, viewerId } = {}) {
  return {
    id: item.id,
    title: item.title,
    url: item.productUrl,
    image: item.imageUrl || (isDirectImage(item.productUrl) ? item.productUrl : ''),
    purchased: item.purchased,
    reserved: isOwner ? false : reserved,
    reservedByMe: !isOwner && item.reservation?.userId === viewerId,
    createdAt: item.createdAt,
  };
}

function serializeList(list, options = {}) {
  const isOwner = options.isOwner ?? list.userId === options.viewerId;
  return {
    id: list.id,
    title: list.title,
    description: list.description,
    visibility: list.visibility,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    owner: list.owner ? serializeUser(list.owner) : undefined,
    items: (list.items || []).map((item) => serializeItem(item, {
      isOwner,
      reserved: Boolean(item.reservation),
      viewerId: options.viewerId,
    })),
  };
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join(' ');
    const error = new Error(message || 'Dados inválidos.');
    error.status = 400;
    throw error;
  }
  return result.data;
}

function createCsrfToken(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  next();
}

function requireCsrf(req, res, next) {
  const expected = req.session.csrfToken;
  const received = req.get('x-csrf-token');
  if (!expected || !received || expected.length !== received.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
    return res.status(403).json({ error: 'Sua sessão expirou. Atualize a página e tente novamente.' });
  }
  next();
}

const registrationSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Use apenas letras, números e _.').transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(10).max(72),
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72),
});
const profileSchema = z.object({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(160).default(''),
  visibility: z.enum(['public', 'private']),
});
const resetRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});
const resetPasswordSchema = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(10).max(72),
});
const previewSchema = z.object({
  url: z.string().trim().url().max(2048).refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  }, 'Informe um endereço HTTPS sem credenciais.'),
});
const listSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(180).default(''),
  visibility: z.enum(['public', 'private']).default('public'),
});
const itemSchema = z.object({
  title: z.string().trim().min(1).max(150),
  url: z.string().trim().url().max(2048).refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  }, 'O link precisa usar http ou https e não pode incluir credenciais.'),
});
const imageSchema = z.string().trim().url().max(2048).refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, 'A imagem precisa usar um endereço http ou https válido.').nullable().optional();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});
const previewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas prévias solicitadas. Tente novamente mais tarde.' },
});
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
}).single('avatar');

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/auth/csrf', (req, res) => {
  if (!req.session.csrfToken) createCsrfToken(req);
  res.json({ csrfToken: req.session.csrfToken });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({
    passwordResetEnabled: Boolean(smtpTransport),
    imagePreviewEnabled: previewAllowedHosts.length > 0,
  });
});

app.post('/api/auth/register', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const input = parse(registrationSchema, req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      username: input.username,
      displayName: input.displayName,
      passwordHash,
    },
    select: publicUserSelect,
  });
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  const csrfToken = createCsrfToken(req);
  res.status(201).json({ user: serializeUser(user), csrfToken });
}));

app.post('/api/auth/password-reset/request', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  if (!smtpTransport) return res.status(503).json({ error: 'A recuperação de senha ainda não está configurada.' });
  const input = parse(resetRequestSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true, email: true, displayName: true } });
  if (!user) return res.json({ message: 'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.' });

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await prisma.passwordResetToken.upsert({
    where: { userId: user.id },
    create: { userId: user.id, tokenHash, expiresAt },
    update: { tokenHash, expiresAt, createdAt: new Date() },
  });

  const resetUrl = new URL('/', appUrl);
  resetUrl.searchParams.set('reset', token);
  try {
    await smtpTransport.sendMail({
      from: smtpFrom,
      to: user.email,
      subject: 'Redefina sua senha do wishly',
      text: `Olá, ${user.displayName}!\n\nUse este link para escolher uma nova senha. Ele expira em 30 minutos:\n${resetUrl.href}\n\nSe você não pediu a redefinição, ignore este e-mail.`,
    });
  } catch (error) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, tokenHash } });
    console.error('Password reset email could not be sent.', error);
    return res.status(503).json({ error: 'Não foi possível enviar o e-mail de recuperação. Tente novamente mais tarde.' });
  }
  res.json({ message: 'Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.' });
}));

app.post('/api/auth/password-reset/confirm', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const input = parse(resetPasswordSchema, req.body);
  const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');
  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!reset || reset.expiresAt <= new Date()) {
    if (reset) await prisma.passwordResetToken.deleteMany({ where: { userId: reset.userId, tokenHash } });
    return res.status(400).json({ error: 'Esse link expirou ou não é válido. Peça um novo link de recuperação.' });
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    await prisma.$transaction(async (transaction) => {
      const consumed = await transaction.passwordResetToken.deleteMany({
        where: { userId: reset.userId, tokenHash, expiresAt: { gt: new Date() } },
      });
      if (!consumed.count) {
        const error = new Error('Esse link expirou ou já foi usado.');
        error.status = 400;
        throw error;
      }
      await transaction.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    });
    await pool.query("DELETE FROM user_sessions WHERE sess->>'userId' = $1", [reset.userId]);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    throw error;
  }
  res.json({ message: 'Sua senha foi redefinida. Entre com a nova senha.' });
}));

app.post('/api/auth/login', authLimiter, requireCsrf, asyncRoute(async (req, res) => {
  const input = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email }, select: { ...publicUserSelect, passwordHash: true } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  const csrfToken = createCsrfToken(req);
  res.json({ user: serializeUser(user), csrfToken });
}));

app.post('/api/auth/logout', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
  res.clearCookie('wishly.sid', { httpOnly: true, secure: isProduction, sameSite: 'lax' });
  res.status(204).end();
}));

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = await prisma.user.findUnique({ where: { id: req.session.userId }, select: publicUserSelect });
  if (!user) {
    req.session.userId = undefined;
    return res.json({ user: null });
  }
  res.json({ user: serializeUser(user) });
}));

app.use('/api', requireAuth);
app.use('/api', requireCsrfForMutations);

function requireCsrfForMutations(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  requireCsrf(req, res, next);
}

app.post('/api/me/avatar', avatarUpload, asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Escolha uma imagem JPEG, PNG ou WebP.' });
  const fileType = await fileTypeFromBuffer(req.file.buffer);
  if (!fileType || !['image/jpeg', 'image/png', 'image/webp'].includes(fileType.mime)) {
    return res.status(415).json({ error: 'Formato não aceito. Use uma imagem JPEG, PNG ou WebP.' });
  }
  const user = await prisma.user.update({
    where: { id: req.session.userId },
    data: { avatarData: req.file.buffer, avatarMime: fileType.mime, avatarUpdatedAt: new Date() },
    select: publicUserSelect,
  });
  res.json({ user: serializeUser(user) });
}));

app.delete('/api/me/avatar', asyncRoute(async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.session.userId },
    data: { avatarData: null, avatarMime: null, avatarUpdatedAt: null },
    select: publicUserSelect,
  });
  res.json({ user: serializeUser(user) });
}));

app.get('/api/users/:userId/avatar', asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { id: true, profileVisibility: true, avatarData: true, avatarMime: true },
  });
  if (!user?.avatarData || !user.avatarMime) return res.status(404).end();
  if (user.profileVisibility === 'private' && user.id !== req.session.userId) {
    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: req.session.userId, followingId: user.id } },
      select: { status: true },
    });
    if (follow?.status !== 'accepted') return res.status(404).end();
  }
  res.set({ 'Content-Type': user.avatarMime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  res.send(Buffer.from(user.avatarData));
}));

app.post('/api/previews', previewLimiter, asyncRoute(async (req, res) => {
  const input = parse(previewSchema, req.body);
  try {
    const preview = await getProductImage(input.url, previewAllowedHosts);
    res.json(preview);
  } catch (error) {
    if (error.message === 'A prévia não está habilitada para esse domínio.') {
      return res.status(422).json({ error: error.message });
    }
    console.warn('Product image preview was not available:', error.message);
    res.status(502).json({ error: 'Não foi possível buscar a imagem dessa página.' });
  }
}));

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  const userId = req.session.userId;
  const [user, lists, follows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect }),
    prisma.wishlist.findMany({
      where: { userId },
      include: { items: { include: { reservation: { select: { id: true, userId: true } } }, orderBy: { createdAt: 'desc' } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.follow.findMany({
      where: { followerId: userId, status: 'accepted' },
      include: { following: { select: publicUserSelect } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const followedIds = follows.map((follow) => follow.followingId);
  const feedItems = await prisma.wishlistItem.findMany({
    where: { wishlist: { userId: { in: followedIds }, visibility: 'public' } },
    include: { wishlist: { include: { owner: { select: publicUserSelect } } } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  res.json({
    user: serializeUser(user),
    lists: lists.map((list) => serializeList(list, { isOwner: true, viewerId: userId })),
    following: follows.map((follow) => serializeUser(follow.following)),
    feed: feedItems.map((item) => ({
      id: item.id,
      user: serializeUser(item.wishlist.owner),
      list: item.wishlist.title,
      item: item.title,
      url: item.productUrl,
      image: item.imageUrl || (isDirectImage(item.productUrl) ? item.productUrl : ''),
      time: item.createdAt,
      tag: item.wishlist.title.toLocaleUpperCase('pt-BR'),
    })),
  });
}));

app.patch('/api/me', asyncRoute(async (req, res) => {
  const input = parse(profileSchema, req.body);
  const [user] = await prisma.$transaction(async (transaction) => {
    const updatedUser = await transaction.user.update({
      where: { id: req.session.userId },
      data: { username: input.username, displayName: input.displayName, bio: input.bio, profileVisibility: input.visibility },
      select: publicUserSelect,
    });
    if (input.visibility === 'public') {
      await transaction.follow.updateMany({
        where: { followingId: req.session.userId, status: 'pending' },
        data: { status: 'accepted' },
      });
    }
    return [updatedUser];
  });
  res.json({ user: serializeUser(user) });
}));

app.get('/api/search', asyncRoute(async (req, res) => {
  const query = z.string().trim().min(1).max(80).parse(req.query.q || '');
  const [users, lists] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [
        {
          profileVisibility: 'public',
          OR: [{ username: { contains: query, mode: 'insensitive' } }, { displayName: { contains: query, mode: 'insensitive' } }],
        },
        { profileVisibility: 'private', username: { equals: query.replace(/^@/, ''), mode: 'insensitive' } },
      ] },
      select: publicUserSelect,
      take: 20,
      orderBy: { displayName: 'asc' },
    }),
    prisma.wishlist.findMany({
      where: {
        visibility: 'public',
        owner: { profileVisibility: 'public' },
        title: { contains: query, mode: 'insensitive' },
      },
      include: { owner: { select: publicUserSelect }, items: { select: { id: true } } },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);
  res.json({
    people: users.filter((user) => user.id !== req.session.userId).map((user) => (
      user.profileVisibility === 'private'
        ? { ...serializeUser(user), bio: '', listsCount: 0, followersCount: undefined }
        : serializeUser(user)
    )),
    lists: lists.map((list) => ({
      id: list.id,
      title: list.title,
      description: list.description,
      visibility: list.visibility,
      items: list.items,
      owner: serializeUser(list.owner),
    })),
  });
}));

app.get('/api/explore', asyncRoute(async (_req, res) => {
  const [users, lists] = await Promise.all([
    prisma.user.findMany({
      where: { profileVisibility: 'public' },
      select: publicUserSelect,
      take: 12,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.wishlist.findMany({
      where: { visibility: 'public', owner: { profileVisibility: 'public' } },
      include: { owner: { select: publicUserSelect }, items: { select: { id: true } } },
      take: 12,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);
  res.json({
    people: users.map((user) => serializeUser(user)),
    lists: lists.map((list) => ({
      id: list.id,
      title: list.title,
      description: list.description,
      visibility: list.visibility,
      items: list.items,
      owner: serializeUser(list.owner),
    })),
  });
}));

app.get('/api/users/:username', asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { username: req.params.username.toLowerCase() },
    select: publicUserSelect,
  });
  if (!user) return res.status(404).json({ error: 'Perfil não encontrado.' });
  const follow = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: req.session.userId, followingId: user.id } },
  });
  const isOwner = user.id === req.session.userId;
  const canViewProfile = user.profileVisibility === 'public' || isOwner || follow?.status === 'accepted';
  if (!canViewProfile) {
    return res.json({
      user: { ...serializeUser(user), bio: '', listsCount: 0, followersCount: undefined },
      followStatus: follow?.status || 'none',
      profileLocked: true,
      lists: [],
    });
  }
  const lists = await prisma.wishlist.findMany({
    where: { userId: user.id, visibility: 'public' },
    include: {
      items: {
        include: { reservation: { select: { id: true, userId: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({
    user: serializeUser(user),
    followStatus: follow?.status || 'none',
    profileLocked: false,
    lists: lists.map((list) => serializeList(list, { isOwner: user.id === req.session.userId, viewerId: req.session.userId })),
  });
}));

app.post('/api/users/:userId/follow', asyncRoute(async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true, profileVisibility: true } });
  if (!target) return res.status(404).json({ error: 'Perfil não encontrado.' });
  if (target.id === req.session.userId) return res.status(400).json({ error: 'Você não pode seguir a si mesmo.' });
  const follow = await prisma.follow.upsert({
    where: { followerId_followingId: { followerId: req.session.userId, followingId: target.id } },
    create: { followerId: req.session.userId, followingId: target.id, status: target.profileVisibility === 'public' ? 'accepted' : 'pending' },
    update: {},
  });
  res.json({ status: follow.status });
}));

app.delete('/api/users/:userId/follow', asyncRoute(async (req, res) => {
  await prisma.follow.deleteMany({ where: { followerId: req.session.userId, followingId: req.params.userId } });
  res.status(204).end();
}));

app.get('/api/me/follow-requests', asyncRoute(async (req, res) => {
  const requests = await prisma.follow.findMany({
    where: { followingId: req.session.userId, status: 'pending' },
    include: { follower: { select: publicUserSelect } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ requests: requests.map((request) => ({ ...serializeUser(request.follower), requestedAt: request.createdAt })) });
}));

app.post('/api/me/follow-requests/:followerId/accept', asyncRoute(async (req, res) => {
  const accepted = await prisma.follow.updateMany({
    where: { followerId: req.params.followerId, followingId: req.session.userId, status: 'pending' },
    data: { status: 'accepted' },
  });
  if (!accepted.count) return res.status(404).json({ error: 'Esse pedido não está mais pendente.' });
  res.status(204).end();
}));

app.delete('/api/me/follow-requests/:followerId', asyncRoute(async (req, res) => {
  await prisma.follow.deleteMany({
    where: { followerId: req.params.followerId, followingId: req.session.userId, status: 'pending' },
  });
  res.status(204).end();
}));

app.get('/api/lists/:listId', asyncRoute(async (req, res) => {
  const list = await prisma.wishlist.findUnique({
    where: { id: req.params.listId },
    include: {
      owner: { select: publicUserSelect },
      items: { include: { reservation: { select: { id: true, userId: true } } }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!list) return res.status(404).json({ error: 'Lista não encontrada.' });
  if (list.userId !== req.session.userId) {
    let canViewProfile = list.owner.profileVisibility === 'public';
    if (!canViewProfile) {
      const follow = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: req.session.userId, followingId: list.userId } },
        select: { status: true },
      });
      canViewProfile = follow?.status === 'accepted';
    }
    if (list.visibility !== 'public' || !canViewProfile) return res.status(404).json({ error: 'Lista não encontrada.' });
  }
  res.json({ list: serializeList(list, { isOwner: list.userId === req.session.userId, viewerId: req.session.userId }) });
}));

app.post('/api/lists', asyncRoute(async (req, res) => {
  const input = parse(listSchema, req.body);
  const list = await prisma.wishlist.create({ data: { ...input, userId: req.session.userId }, include: { items: true } });
  res.status(201).json({ list: serializeList(list, { isOwner: true }) });
}));

app.patch('/api/lists/:listId', asyncRoute(async (req, res) => {
  const input = parse(listSchema, req.body);
  const changed = await prisma.wishlist.updateMany({ where: { id: req.params.listId, userId: req.session.userId }, data: input });
  if (!changed.count) return res.status(404).json({ error: 'Lista não encontrada.' });
  const list = await prisma.wishlist.findUnique({ where: { id: req.params.listId }, include: { items: true } });
  res.json({ list: serializeList(list, { isOwner: true }) });
}));

app.delete('/api/lists/:listId', asyncRoute(async (req, res) => {
  const deleted = await prisma.wishlist.deleteMany({ where: { id: req.params.listId, userId: req.session.userId } });
  if (!deleted.count) return res.status(404).json({ error: 'Lista não encontrada.' });
  res.status(204).end();
}));

app.post('/api/lists/:listId/items', asyncRoute(async (req, res) => {
  const input = parse(itemSchema.extend({ image: imageSchema }), req.body);
  const list = await prisma.wishlist.findFirst({ where: { id: req.params.listId, userId: req.session.userId }, select: { id: true } });
  if (!list) return res.status(404).json({ error: 'Lista não encontrada.' });
  const item = await prisma.wishlistItem.create({
    data: {
      wishlistId: list.id,
      title: input.title,
      productUrl: input.url,
      imageUrl: input.image || null,
    },
  });
  res.status(201).json({ item: serializeItem(item, { isOwner: true }) });
}));

app.patch('/api/items/:itemId', asyncRoute(async (req, res) => {
  const input = parse(itemSchema.extend({ image: imageSchema }), req.body);
  const changed = await prisma.wishlistItem.updateMany({
    where: { id: req.params.itemId, wishlist: { userId: req.session.userId } },
    data: { title: input.title, productUrl: input.url, imageUrl: input.image || null },
  });
  if (!changed.count) return res.status(404).json({ error: 'Desejo não encontrado.' });
  const item = await prisma.wishlistItem.findUnique({ where: { id: req.params.itemId } });
  res.json({ item: serializeItem(item, { isOwner: true }) });
}));

app.patch('/api/items/:itemId/purchased', asyncRoute(async (req, res) => {
  const purchased = z.boolean().parse(req.body.purchased);
  const changed = await prisma.wishlistItem.updateMany({
    where: { id: req.params.itemId, wishlist: { userId: req.session.userId } },
    data: { purchased },
  });
  if (!changed.count) return res.status(404).json({ error: 'Desejo não encontrado.' });
  if (purchased) await prisma.reservation.deleteMany({ where: { itemId: req.params.itemId } });
  res.status(204).end();
}));

app.delete('/api/items/:itemId', asyncRoute(async (req, res) => {
  const deleted = await prisma.wishlistItem.deleteMany({ where: { id: req.params.itemId, wishlist: { userId: req.session.userId } } });
  if (!deleted.count) return res.status(404).json({ error: 'Desejo não encontrado.' });
  res.status(204).end();
}));

app.post('/api/items/:itemId/reservation', asyncRoute(async (req, res) => {
  const item = await prisma.wishlistItem.findFirst({
    where: { id: req.params.itemId, wishlist: { visibility: 'public' } },
    select: { id: true, purchased: true, wishlist: { select: { userId: true } } },
  });
  if (!item || item.wishlist.userId === req.session.userId || item.purchased) {
    return res.status(404).json({ error: 'Esse desejo não está disponível para reserva.' });
  }
  const owner = await prisma.user.findUnique({
    where: { id: item.wishlist.userId },
    select: { profileVisibility: true },
  });
  if (owner?.profileVisibility === 'private') {
    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: req.session.userId, followingId: item.wishlist.userId } },
      select: { status: true },
    });
    if (follow?.status !== 'accepted') return res.status(404).json({ error: 'Esse desejo não está disponível para reserva.' });
  }
  await prisma.reservation.create({ data: { itemId: item.id, userId: req.session.userId } });
  res.status(204).end();
}));

app.delete('/api/items/:itemId/reservation', asyncRoute(async (req, res) => {
  await prisma.reservation.deleteMany({ where: { itemId: req.params.itemId, userId: req.session.userId } });
  res.status(204).end();
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint não encontrado.' }));

if (isProduction) {
  const clientPath = path.resolve(__dirname, '../dist');
  app.use(express.static(clientPath));
  app.get('*', (_req, res) => res.sendFile(path.join(clientPath, 'index.html')));
}

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: status === 413 ? 'A foto deve ter no máximo 2 MB.' : 'Envie apenas uma foto de perfil.' });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(' ') : String(error.meta?.target || '');
      if (target.includes('itemId')) return res.status(409).json({ error: 'Outra pessoa já reservou esse desejo.' });
      return res.status(409).json({ error: 'Esse e-mail ou nome de usuário já está em uso.' });
    }
    if (error.code === 'P2025') return res.status(404).json({ error: 'Registro não encontrado.' });
    if (error.code === 'P2003') return res.status(400).json({ error: 'Não foi possível concluir essa operação.' });
    if (error.code === 'P2023') return res.status(404).json({ error: 'Registro não encontrado.' });
  }
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map((issue) => issue.message).join(' ') });
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status === 500 ? 'Ocorreu um erro interno. Tente novamente.' : error.message });
});

const port = Number(process.env.PORT || 3001);
const server = app.listen(port, () => console.log(`wishly API running on http://localhost:${port}`));

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
