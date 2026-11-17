import { useEffect, useState } from 'react';
import { api, uploadAvatar } from './api.js';

function Icon({ name, size = 20 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    list: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h8M8 17h4" /></>,
    users: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" /><circle cx="9.5" cy="7" r="3.5" /><path d="M17 11a3.5 3.5 0 0 0 0-7M21 20v-1.5a4 4 0 0 0-3-3.87" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3" /></>,
    edit: <><path d="m14 5 5 5M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    heart: <path d="M20.8 8.8c0 5.2-8.8 10-8.8 10s-8.8-4.8-8.8-10A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.8 2.4Z" />,
    gift: <><rect x="3" y="9" width="18" height="12" rx="2" /><path d="M12 9v12M3 13h18M12 9H7a2.5 2.5 0 1 1 2.5-2.5V9Zm0 0h5a2.5 2.5 0 1 0-2.5-2.5V9Z" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function isDirectImage(url) {
  return /\.(jpe?g|png|gif|webp|avif)(\?.*)?$/i.test(url);
}

function Avatar({ person, small = false }) {
  return <span className={`avatar avatar-${person.color || 'lilac'} ${small ? 'avatar-small' : ''}`}>{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : person.avatar}</span>;
}

function formatRelativeTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  const hours = Math.round((date.getTime() - Date.now()) / 3_600_000);
  if (Math.abs(hours) < 1) return 'agora';
  if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' }).format(hours, 'hour');
  const days = Math.round(hours / 24);
  return new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' }).format(days, 'day');
}

function App() {
  const [user, setUser] = useState(null);
  const [data, setData] = useState({ lists: [], following: [], feed: [] });
  const [followRequests, setFollowRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [page, setPage] = useState('home');
  const [activeListId, setActiveListId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [publicList, setPublicList] = useState(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ people: [], lists: [] });
  const [exploreResults, setExploreResults] = useState({ people: [], lists: [] });
  const [modal, setModal] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState('');
  const [draft, setDraft] = useState({});
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(false);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadDashboard() {
    const [result, requestResult] = await Promise.all([api('/dashboard'), api('/me/follow-requests')]);
    setUser(result.user);
    setData({ lists: result.lists, following: result.following, feed: result.feed });
    setFollowRequests(requestResult.requests);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [result, config] = await Promise.all([api('/auth/me'), api('/auth/config')]);
        if (!active) return;
        setPreviewEnabled(config.imagePreviewEnabled);
        if (result.user) {
          setUser(result.user);
          await loadDashboard();
        } else {
          await api('/auth/csrf');
        }
      } catch (error) {
        if (active) setConnectionError(error.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (!term || !user) {
      setSearchResults({ people: [], lists: [] });
      return undefined;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const result = await api(`/search?q=${encodeURIComponent(term)}`);
        if (active) setSearchResults(result);
      } catch (error) {
        if (active) setToast(error.message);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, user]);

  useEffect(() => {
    if (page !== 'explore' || query.trim()) return undefined;
    let active = true;
    api('/explore').then((result) => {
      if (active) setExploreResults(result);
    }).catch(reportError);
    return () => { active = false; };
  }, [page, query]);

  const activeList = data.lists.find((list) => list.id === activeListId);
  const followedPeople = data.following;

  function reportError(error) {
    setToast(error.message || 'Não foi possível concluir a operação.');
  }

  async function refreshAfter(work) {
    try {
      await work();
      await loadDashboard();
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  function navigate(nextPage) {
    setPage(nextPage);
    setActiveListId(null);
    setProfile(null);
    setPublicList(null);
    setQuery('');
    setMobileNav(false);
  }

  function openList(listId) {
    setPage('my-lists');
    setActiveListId(listId);
    setProfile(null);
    setPublicList(null);
    setQuery('');
    setMobileNav(false);
  }

  async function openProfile(person) {
    try {
      const result = await api(`/users/${encodeURIComponent(person.username)}`);
      setProfile({ ...result.user, lists: result.lists, followStatus: result.followStatus, profileLocked: result.profileLocked });
      setPublicList(null);
      setPage('profile');
      setActiveListId(null);
      setQuery('');
      setMobileNav(false);
    } catch (error) {
      reportError(error);
    }
  }

  async function openPublicList(list) {
    try {
      const result = await api(`/lists/${list.id}`);
      const profileResult = await api(`/users/${encodeURIComponent(result.list.owner.username)}`);
      setProfile({ ...profileResult.user, lists: profileResult.lists, followStatus: profileResult.followStatus, profileLocked: profileResult.profileLocked });
      setPublicList(result.list);
      setPage('profile');
      setActiveListId(null);
      setQuery('');
    } catch (error) {
      reportError(error);
    }
  }

  async function submitList(event) {
    event.preventDefault();
    try {
      const input = { title: draft.title.trim(), description: (draft.description || '').trim(), visibility: draft.visibility || 'public' };
      if (modal?.type === 'edit-list') {
        await api(`/lists/${modal.list.id}`, { method: 'PATCH', body: input });
        setToast('Lista atualizada');
      } else {
        const result = await api('/lists', { method: 'POST', body: input });
        setActiveListId(result.list.id);
        setPage('my-lists');
        setToast('Lista criada! Adicione seu primeiro desejo.');
      }
      await loadDashboard();
      setModal(null);
    } catch (error) {
      reportError(error);
    }
  }

  async function submitProfile(event) {
    event.preventDefault();
    try {
      const result = await api('/me', {
        method: 'PATCH',
        body: { displayName: draft.name.trim(), username: draft.username.trim().replace(/^@/, ''), bio: draft.bio.trim(), visibility: draft.visibility },
      });
      setUser(result.user);
      setModal(null);
      setToast('Perfil atualizado');
      await loadDashboard();
    } catch (error) {
      reportError(error);
    }
  }

  async function submitItem(event) {
    event.preventDefault();
    const title = draft.title.trim();
    const url = draft.url.trim();
    if (!title || !url || !activeList) return;
    try {
      const safeUrl = new URL(url);
      if (!['https:', 'http:'].includes(safeUrl.protocol)) throw new Error('Use um link começando com http:// ou https://');
      const input = { title, url: safeUrl.toString(), image: draft.image || (isDirectImage(safeUrl.toString()) ? safeUrl.toString() : null) };
      if (modal?.type === 'edit-item') {
        await api(`/items/${modal.item.id}`, { method: 'PATCH', body: input });
      } else {
        await api(`/lists/${activeList.id}/items`, { method: 'POST', body: input });
      }
      await loadDashboard();
      setModal(null);
      setToast(modal?.type === 'edit-item' ? 'Desejo atualizado' : 'Desejo adicionado');
    } catch (error) {
      reportError(error);
    }
  }

  async function fetchItemPreview() {
    const url = draft.url?.trim();
    if (!url) return;
    setPreviewBusy(true);
    try {
      const result = await api('/previews', { method: 'POST', body: { url } });
      if (!result.imageUrl) {
        setToast('Essa página não disponibilizou uma imagem de prévia.');
        return;
      }
      setDraft((current) => ({ ...current, image: result.imageUrl }));
    } catch (error) {
      reportError(error);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function togglePurchased(item) {
    await refreshAfter(() => api(`/items/${item.id}/purchased`, { method: 'PATCH', body: { purchased: !item.purchased } }));
  }

  async function deleteItem(itemId) {
    if (await refreshAfter(() => api(`/items/${itemId}`, { method: 'DELETE' }))) setToast('Desejo removido da lista');
  }

  async function deleteList(listId) {
    if (await refreshAfter(() => api(`/lists/${listId}`, { method: 'DELETE' }))) {
      setActiveListId(null);
      setToast('Lista excluída');
      return true;
    }
    return false;
  }

  function requestCopy(item) {
    setDraft({ listId: data.lists[0]?.id || '' });
    setModal({ type: 'copy-item', item });
  }

  async function submitCopy(event) {
    event.preventDefault();
    try {
      let destination = data.lists.find((list) => list.id === draft.listId);
      if (!destination) {
        const created = await api('/lists', { method: 'POST', body: { title: 'Meus desejos', description: '', visibility: 'public' } });
        destination = created.list;
      }
      await api(`/lists/${destination.id}/items`, {
        method: 'POST',
        body: { title: modal.item.title, url: modal.item.url, image: modal.item.image || null },
      });
      await loadDashboard();
      setModal(null);
      setToast(`Adicionado a “${destination.title}”`);
    } catch (error) {
      reportError(error);
    }
  }

  async function toggleReservation(item) {
    try {
      const method = item.reserved ? 'DELETE' : 'POST';
      await api(`/items/${item.id}/reservation`, { method });
      const result = await api(`/lists/${publicList.id}`);
      setPublicList(result.list);
      setToast(item.reserved ? 'Reserva cancelada' : 'Desejo reservado para presentear');
    } catch (error) {
      reportError(error);
    }
  }

  async function toggleFollow(person) {
    try {
      const status = person.followStatus || (person.followed ? 'accepted' : 'none');
      const result = await api(`/users/${person.id}/follow`, { method: status === 'none' ? 'POST' : 'DELETE' });
      await loadDashboard();
      const nextStatus = status === 'none' ? result.status : 'none';
      setProfile((current) => current ? { ...current, followStatus: nextStatus } : current);
      setToast(nextStatus === 'pending' ? 'Pedido para seguir enviado' : nextStatus === 'accepted' ? 'Você está seguindo este perfil' : status === 'pending' ? 'Pedido cancelado' : 'Você deixou de seguir este perfil');
    } catch (error) {
      reportError(error);
    }
  }

  async function respondToFollowRequest(request, accept) {
    try {
      const path = `/me/follow-requests/${request.id}${accept ? '/accept' : ''}`;
      await api(path, { method: accept ? 'POST' : 'DELETE' });
      await loadDashboard();
      setToast(accept ? `Agora você segue ${request.name}` : 'Pedido removido');
    } catch (error) {
      reportError(error);
    }
  }

  async function changeAvatar(file) {
    try {
      const result = await uploadAvatar(file);
      setUser(result.user);
      await loadDashboard();
      setToast('Foto de perfil atualizada');
    } catch (error) {
      reportError(error);
    }
  }

  async function removeAvatar() {
    if (await refreshAfter(async () => {
      const result = await api('/me/avatar', { method: 'DELETE' });
      setUser(result.user);
    })) setToast('Foto de perfil removida');
  }

  function startListModal(list = null) {
    setDraft(list ? { title: list.title, description: list.description || '', visibility: list.visibility } : { title: '', description: '', visibility: 'public' });
    setModal(list ? { type: 'edit-list', list } : { type: 'new-list' });
  }

  function startItemModal(item = null) {
    setDraft(item ? { title: item.title, url: item.url, image: item.image, description: '', visibility: 'public' } : { title: '', url: '', image: '', description: '', visibility: 'public' });
    setModal(item ? { type: 'edit-item', item } : { type: 'new-item' });
  }

  function startProfileModal() {
    setDraft({ name: user.name, username: user.username, bio: user.bio, visibility: user.visibility });
    setModal({ type: 'edit-profile' });
  }

  async function authenticate(mode, input) {
    const endpoint = mode === 'register' ? '/auth/register' : '/auth/login';
    const body = mode === 'register'
      ? { email: input.email, password: input.password, displayName: input.displayName, username: input.username }
      : { email: input.email, password: input.password };
    const result = await api(endpoint, { method: 'POST', body });
    setUser(result.user);
    await loadDashboard();
    setPage('home');
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      setUser(null);
      setData({ lists: [], following: [], feed: [] });
      setPage('home');
      setToast('');
      await api('/auth/csrf');
    } catch (error) {
      reportError(error);
    }
  }

  const pageTitle = activeList ? activeList.title : profile ? profile.name : ({ home: `Bom dia, ${user?.name?.split(' ')[0] || ''}`, explore: 'Explore', 'my-lists': 'Minhas listas', following: 'Seguindo', profile: 'Perfil' }[page] || 'wishly');

  if (loading) return <div className="app-loading"><span className="brand-mark"><Icon name="heart" size={18} /></span><strong>wishly.</strong><span>Preparando seu espaço...</span></div>;
  if (connectionError) return <ConnectionError message={connectionError} onRetry={() => window.location.reload()} />;
  if (!user) return <AuthPage onAuthenticate={authenticate} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <button className="brand" onClick={() => navigate('home')} aria-label="wishly, página inicial">
          <span className="brand-mark"><Icon name="heart" size={18} /></span><span>wishly<span className="brand-dot">.</span></span>
        </button>
        <div className="sidebar-label">MENU</div>
        <nav className="main-nav" aria-label="Navegação principal">
          <button className={page === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('home')}><Icon name="home" />Início</button>
          <button className={page === 'explore' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('explore')}><Icon name="search" />Explorar</button>
          <button className={page === 'my-lists' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('my-lists')}><Icon name="list" />Minhas listas<span className="nav-count">{data.lists.length}</span></button>
          <button className={page === 'following' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('following')}><Icon name="users" />Seguindo<span className="nav-count">{data.following.length}</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><span className="note-spark">✳</span><p>Presentes sem<br />adivinhação.</p><span>Do seu jeito, no seu tempo.</span></div>
          <button className={`profile-shortcut ${page === 'profile' && !profile ? 'active' : ''}`} onClick={() => { setProfile(null); setPublicList(null); navigate('profile'); }}>
            <Avatar person={user} small /><span className="profile-shortcut-copy"><strong>{user.name}</strong><small>meu perfil</small></span><Icon name="chevron" size={17} />
          </button>
        </div>
      </aside>

      {mobileNav && <button className="mobile-backdrop" onClick={() => setMobileNav(false)} aria-label="Fechar menu" />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Abrir menu"><Icon name="menu" /></button>
          <div className="breadcrumb"><span>workspace</span><Icon name="chevron" size={14} /><strong>{pageTitle}</strong></div>
          <label className="search-box">
            <Icon name="search" size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => { if (page !== 'explore') setPage('explore'); }} placeholder="Buscar pessoas ou listas..." aria-label="Buscar pessoas ou listas" />
            <kbd>⌘ K</kbd>
          </label>
          <button className="top-avatar" onClick={() => { setProfile(null); setPublicList(null); navigate('profile'); }} aria-label="Abrir meu perfil">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.avatar}</button>
        </header>

        <div className="page-content">
          {query.trim() ? (
            <ExplorePage query={query} peopleResults={searchResults.people} listResults={searchResults.lists} onProfile={openProfile} onClear={() => setQuery('')} onList={openPublicList} />
          ) : activeList ? (
            <ListDetail list={activeList} onBack={() => setActiveListId(null)} onAdd={() => startItemModal()} onEdit={() => startListModal(activeList)} onDelete={() => setModal({ type: 'confirm-delete-list', list: activeList })} onEditItem={startItemModal} onDeleteItem={deleteItem} onPurchased={(itemId) => togglePurchased(activeList.items.find((item) => item.id === itemId))} />
          ) : profile ? (
            publicList ? (
              <PublicListDetail person={profile} list={publicList} onBack={() => setPublicList(null)} onCopy={requestCopy} onReserve={toggleReservation} />
            ) : (
              <ProfilePage person={profile} followStatus={profile.followStatus} profileLocked={profile.profileLocked} onFollow={() => toggleFollow(profile)} onBack={() => navigate('explore')} onOpenList={openPublicList} />
            )
          ) : page === 'home' ? (
            <HomePage user={user} lists={data.lists} followedPeople={followedPeople} feedItems={data.feed} onNavigate={navigate} onProfile={openProfile} onList={openList} onNewList={() => startListModal()} onCopy={requestCopy} />
          ) : page === 'my-lists' ? (
            <MyListsPage lists={data.lists} onList={openList} onNew={() => startListModal()} onEdit={startListModal} />
          ) : page === 'following' ? (
            <FollowingPage followedPeople={followedPeople} onProfile={openProfile} onUnfollow={(person) => toggleFollow({ ...person, followed: true })} onExplore={() => navigate('explore')} />
          ) : page === 'profile' ? (
            <MyProfile lists={data.lists} profile={user} requests={followRequests} onList={openList} onEdit={startProfileModal} onNew={() => startListModal()} onLogout={logout} onAvatar={changeAvatar} onRemoveAvatar={removeAvatar} onRespondToRequest={respondToFollowRequest} />
          ) : (
            <ExplorePage query="" peopleResults={exploreResults.people} listResults={exploreResults.lists} onProfile={openProfile} onClear={() => setQuery('')} onList={openPublicList} />
          )}
        </div>
        <footer className="page-footer"><span>feito com carinho, para presentear melhor</span><span>© 2025 wishly</span></footer>
      </main>

      {modal && (
        <Modal onClose={() => setModal(null)}>
          {(modal.type === 'new-list' || modal.type === 'edit-list') && (
            <form onSubmit={submitList} className="modal-form">
              <span className="modal-icon"><Icon name="list" /></span>
              <h2>{modal.type === 'edit-list' ? 'Editar lista' : 'Criar uma lista'}</h2>
              <p>Organize seus desejos do seu jeito.</p>
              <label>Nome da lista<input autoFocus maxLength="80" placeholder="Ex.: Skincare, livros..." value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label>
              <label>Descrição <span className="optional">opcional</span><textarea maxLength="180" rows="2" placeholder="Um pouquinho sobre essa lista" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
              <label>Quem pode ver essa lista?
                <select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value })}>
                  <option value="public">Pública — qualquer pessoa pode ver</option>
                  <option value="private">Privada — só você pode ver</option>
                </select>
              </label>
              <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button className="button button-primary">{modal.type === 'edit-list' ? 'Salvar alterações' : 'Criar lista'}</button></div>
            </form>
          )}
          {(modal.type === 'new-item' || modal.type === 'edit-item') && (
            <form onSubmit={submitItem} className="modal-form">
              <span className="modal-icon"><Icon name="heart" /></span>
              <h2>{modal.type === 'edit-item' ? 'Editar desejo' : 'Adicionar desejo'}</h2>
              <p>Um link já ajuda quem quer te presentear.</p>
              <label>O que você deseja?<input autoFocus maxLength="150" placeholder="Ex.: Sérum de vitamina C" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label>
              <label>Link do produto<input type="url" placeholder="https://..." value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} required /></label>
              <div className="preview-controls">{previewEnabled ? <button type="button" className="text-button" onClick={fetchItemPreview} disabled={previewBusy}>{previewBusy ? 'Buscando imagem...' : 'Buscar imagem da página'}</button> : <span>Prévia por página desabilitada; links diretos para imagens continuam funcionando.</span>}{draft.image && <img src={draft.image} alt="Prévia do produto" />}</div>
              <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button className="button button-primary">{modal.type === 'edit-item' ? 'Salvar alterações' : 'Adicionar à lista'}</button></div>
            </form>
          )}
          {modal.type === 'edit-profile' && (
            <form onSubmit={submitProfile} className="modal-form">
              <span className="modal-icon"><Icon name="user" /></span>
              <h2>Editar perfil</h2>
              <p>Compartilhe só o que você quiser.</p>
              <label>Nome<input autoFocus maxLength="80" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label>
              <label>Nome de usuário<input maxLength="30" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} required /></label>
              <label>Bio <span className="optional">opcional</span><textarea rows="2" maxLength="160" value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></label>
              <label>Visibilidade do perfil<select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value })}><option value="public">Público — qualquer pessoa pode encontrar</option><option value="private">Privado — somente você pode ver perfil e listas</option></select></label>
              <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button className="button button-primary">Salvar perfil</button></div>
            </form>
          )}
          {modal.type === 'copy-item' && (
            <form onSubmit={submitCopy} className="modal-form">
              <span className="modal-icon"><Icon name="heart" /></span>
              <h2>Guardar este desejo?</h2>
              <p>Uma cópia independente será adicionada à sua lista.</p>
              <div className="copy-item-summary"><strong>{modal.item.title}</strong><a href={modal.item.url} target="_blank" rel="noreferrer">{new URL(modal.item.url).hostname.replace(/^www\./, '')}</a></div>
              {data.lists.length > 0 && <label>Adicionar em<select value={draft.listId} onChange={(event) => setDraft({ ...draft, listId: event.target.value })}>{data.lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>}
              <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button className="button button-primary">Adicionar à minha lista</button></div>
            </form>
          )}
          {modal.type === 'confirm-delete-list' && (
            <div className="modal-form confirm-modal">
              <span className="modal-icon modal-icon-danger"><Icon name="trash" /></span>
              <h2>Excluir esta lista?</h2>
              <p>“{modal.list.title}” e todos os desejos dela serão removidos. Essa ação não pode ser desfeita.</p>
              <div className="modal-actions"><button className="button button-quiet" onClick={() => setModal(null)}>Manter lista</button><button className="button button-danger" onClick={async () => { if (await deleteList(modal.list.id)) setModal(null); }}>Excluir lista</button></div>
            </div>
          )}
        </Modal>
      )}
      {toast && <div className="toast"><span className="toast-check"><Icon name="check" size={15} /></span>{toast}</div>}
    </div>
  );
}

function AuthPage({ onAuthenticate }) {
  const resetToken = new URLSearchParams(window.location.search).get('reset') || '';
  const [mode, setMode] = useState(resetToken ? 'reset-confirm' : 'login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '', username: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [canReset, setCanReset] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/config').then((config) => setCanReset(config.passwordResetEnabled)).catch(() => {});
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (mode === 'reset-request') {
        const result = await api('/auth/password-reset/request', { method: 'POST', body: { email: form.email } });
        setNotice(result.message);
      } else if (mode === 'reset-confirm') {
        const result = await api('/auth/password-reset/confirm', { method: 'POST', body: { token: resetToken, password: form.password } });
        window.history.replaceState({}, '', window.location.pathname);
        setMode('login');
        setForm((current) => ({ ...current, password: '' }));
        setNotice(result.message);
      } else {
        await onAuthenticate(mode, form);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-brand-panel">
      <button className="brand auth-brand" aria-label="wishly"><span className="brand-mark"><Icon name="heart" size={18} /></span><span>wishly<span className="brand-dot">.</span></span></button>
      <div className="auth-hero"><span className="auth-eyebrow">PRESENTES SEM ADIVINHAÇÃO</span><h1>Um jeito mais<br />carinhoso de<br /><em>presentear.</em></h1><p>Guarde seus desejos. Descubra o que importa para quem você gosta.</p><div className="auth-art"><span>✿</span><span>✳</span><span>⌑</span><span className="auth-art-note"><Icon name="gift" size={31} /></span></div></div>
      <span className="auth-footer-note">sua lista, seus desejos.</span>
    </section>
    <section className="auth-form-panel">
      <div className="auth-form-wrap">
        <div className="auth-mobile-brand"><span className="brand-mark"><Icon name="heart" size={18} /></span><strong>wishly<span>.</span></strong></div>
        <div className="eyebrow">{mode === 'login' ? 'QUE BOM TER VOCÊ DE VOLTA' : mode === 'register' ? 'SEU CANTINHO COMEÇA AQUI' : 'RECUPERE O ACESSO'}</div>
        <h2>{mode === 'login' ? 'Entre na sua conta' : mode === 'register' ? 'Crie sua conta' : mode === 'reset-request' ? 'Esqueceu sua senha?' : 'Escolha uma nova senha'}</h2>
        <p>{mode === 'login' ? 'Acesse suas listas e veja as novidades do seu círculo.' : mode === 'register' ? 'Só precisamos do básico. Sem endereço, telefone ou dados de pagamento.' : mode === 'reset-request' ? 'Enviaremos um link de recuperação para o e-mail cadastrado.' : 'O link de recuperação é válido por 30 minutos.'}</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && <>
            <label>Como podemos te chamar?<input autoComplete="name" maxLength="80" placeholder="Seu nome" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required /></label>
            <label>Escolha seu @usuário<input autoComplete="username" minLength="3" maxLength="30" pattern="[A-Za-z0-9_]+" placeholder="ex.: skyantunes" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /><small>Apenas letras, números e _</small></label>
          </>}
          {(mode === 'login' || mode === 'register' || mode === 'reset-request') && <label>E-mail<input autoComplete="email" type="email" maxLength="254" placeholder="voce@email.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>}
          {(mode === 'login' || mode === 'register' || mode === 'reset-confirm') && <label>Senha<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" minLength={mode === 'register' || mode === 'reset-confirm' ? 10 : 1} maxLength="72" placeholder={mode === 'register' || mode === 'reset-confirm' ? 'Pelo menos 10 caracteres' : 'Sua senha'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />{(mode === 'register' || mode === 'reset-confirm') && <small>Use pelo menos 10 caracteres.</small>}</label>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          {notice && <div className="auth-notice" role="status">{notice}</div>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Só um instante...' : mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar minha conta' : mode === 'reset-request' ? 'Enviar link de recuperação' : 'Redefinir senha'}<Icon name="arrow" size={16} /></button>
        </form>
        {mode === 'login' && canReset && <button className="auth-reset-link" onClick={() => { setError(''); setNotice(''); setMode('reset-request'); }}>Esqueceu a senha?</button>}
        {(mode === 'login' || mode === 'register') && <div className="auth-switch">{mode === 'register' ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'} <button onClick={() => { setError(''); setNotice(''); setMode(mode === 'register' ? 'login' : 'register'); }}> {mode === 'register' ? 'Entrar' : 'Criar conta'}</button></div>}
        {mode !== 'login' && <button className="auth-reset-link" onClick={() => { setError(''); setNotice(''); setMode('login'); }}>Voltar para entrar</button>}
        <div className="auth-privacy"><Icon name="lock" size={14} /> Seus dados pessoais não aparecem no perfil.</div>
      </div>
    </section>
  </main>;
}

function ConnectionError({ message, onRetry }) {
  return <main className="connection-error"><span className="modal-icon"><Icon name="heart" /></span><h1>Não foi possível conectar</h1><p>{message}</p><p>Confira se a API e o PostgreSQL estão rodando e tente novamente.</p><button className="button button-primary" onClick={onRetry}>Tentar novamente</button></main>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

function HomePage({ user, lists, followedPeople, feedItems, onNavigate, onProfile, onList, onNewList, onCopy }) {
  const todayLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('pt-BR');
  return (
    <div className="home-page">
      <section className="welcome-banner">
        <div className="welcome-copy"><div className="eyebrow">{todayLabel}</div><h1>Bom dia, {user.name.split(' ')[0]} <span>✳</span></h1><p>Seus desejos de hoje podem ser o presente perfeito de amanhã.</p><button className="button button-light" onClick={onNewList}><Icon name="plus" size={17} /> Criar uma lista</button></div>
        <div className="welcome-art" aria-hidden="true"><div className="art-sun" /><div className="art-card art-card-back">✿</div><div className="art-card art-card-front"><Icon name="gift" size={36} /></div><div className="art-sparkle sparkle-one">✦</div><div className="art-sparkle sparkle-two">✳</div></div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><div className="eyebrow">SEU CANTINHO</div><h2>Suas listas</h2></div><button className="text-button" onClick={() => onNavigate('my-lists')}>Ver todas <Icon name="arrow" size={16} /></button></div>
        <div className="list-preview-grid">
          {lists.slice(0, 3).map((list, index) => <button key={list.id} className={`list-preview preview-${index}`} onClick={() => onList(list.id)}>
            <div className="preview-top"><span className={`preview-icon preview-icon-${index}`}><Icon name={index === 0 ? 'heart' : index === 1 ? 'list' : 'gift'} size={18} /></span><span className={list.visibility === 'private' ? 'visibility-chip private-chip' : 'visibility-chip'}>{list.visibility === 'private' ? <><Icon name="lock" size={12} /> Privada</> : <><Icon name="globe" size={12} /> Pública</>}</span></div>
            <div className="preview-title">{list.title}</div><div className="preview-meta">{list.items.length} {list.items.length === 1 ? 'desejo' : 'desejos'} <Icon name="chevron" size={15} /></div>
            <div className="preview-decoration">{index === 0 ? '✿' : index === 1 ? '⌑' : '✳'}</div>
          </button>)}
          <button className="list-create-card" onClick={onNewList}><span><Icon name="plus" size={21} /></span><strong>Nova lista</strong><small>Um novo cantinho para seus desejos</small></button>
        </div>
      </section>

      <section className="section-block feed-section">
        <div className="section-heading"><div><div className="eyebrow">DO SEU CÍRCULO</div><h2>Novidades de quem você segue</h2></div><button className="text-button" onClick={() => onNavigate('following')}>Ver seguindo <Icon name="arrow" size={16} /></button></div>
        <div className="feed-grid">
          {feedItems.slice(0, 3).map((entry, index) => <article className="feed-card" key={entry.id}>
            <div className="feed-user"><button className="avatar-button" onClick={() => onProfile(entry.user)}><Avatar person={entry.user} small /></button><div><button className="feed-user-name" onClick={() => onProfile(entry.user)}>{entry.user.name}</button><span>adicionou um desejo <span className="feed-time">· {formatRelativeTime(entry.time)}</span></span></div><button className="feed-more" aria-label="Mais opções">···</button></div>
            <div className={`feed-product feed-product-${index}`}><span className="product-category">{entry.tag}</span>{entry.image ? <img className="feed-image" src={entry.image} alt="" /> : <div className="product-illustration">{['✿', '✧', '◒'][index]}</div>}<span className="product-brand">{entry.item}</span></div>
            <div className="feed-card-bottom"><div><span>NA LISTA</span><strong>{entry.list}</strong></div><button className="icon-button" onClick={() => onCopy({ title: entry.item, url: entry.url, image: entry.image })} title="Adicionar à minha lista" aria-label="Adicionar à minha lista"><Icon name="plus" size={18} /></button></div>
          </article>)}
        </div>
        {followedPeople.length === 0 && <div className="empty-note">Siga pessoas para acompanhar as novidades delas.</div>}
        {followedPeople.length > 0 && feedItems.length === 0 && <div className="empty-note">Ainda não há desejos novos no seu círculo.</div>}
      </section>
    </div>
  );
}

function MyListsPage({ lists, onList, onNew, onEdit }) {
  return <div className="standard-page">
    <PageHeading eyebrow="SEU CANTINHO" title="Minhas listas" description="Tudo o que você gostaria de ganhar, organizado do seu jeito." action={<button className="button button-primary" onClick={onNew}><Icon name="plus" size={17} /> Nova lista</button>} />
    {lists.length ? <div className="my-lists-grid">{lists.map((list, index) => <article className={`my-list-card preview-${index % 3}`} key={list.id}>
      <button className="my-list-open" onClick={() => onList(list.id)}><div className="my-list-art"><span>{['✿', '⌑', '✳'][index % 3]}</span><span className="my-list-number">{String(list.items.length).padStart(2, '0')} itens</span></div><div className="my-list-info"><div className="visibility-chip">{list.visibility === 'private' ? <><Icon name="lock" size={12} /> Privada</> : <><Icon name="globe" size={12} /> Pública</>}</div><h3>{list.title}</h3><p>{list.description || 'Sem descrição'}</p><div className="my-list-footer"><span>{list.items.length} {list.items.length === 1 ? 'desejo' : 'desejos'}</span><Icon name="arrow" size={17} /></div></div></button><button className="list-edit-shortcut" onClick={() => onEdit(list)} aria-label={`Editar ${list.title}`}><Icon name="edit" size={16} /></button>
    </article>)}</div> : <EmptyState title="Sua primeira lista começa aqui" text="Crie uma lista para guardar as coisas que gostaria de ganhar." action="Criar minha primeira lista" onClick={onNew} />}
  </div>;
}

function ListDetail({ list, onBack, onAdd, onEdit, onDelete, onEditItem, onDeleteItem, onPurchased }) {
  return <div className="standard-page">
    <button className="back-link" onClick={onBack}><span className="back-arrow">←</span> Minhas listas</button>
    <div className="list-detail-heading"><div><div className="eyebrow">{list.visibility === 'private' ? 'LISTA PRIVADA' : 'SUA LISTA'}</div><h1>{list.title}</h1><p>{list.description || 'Seus desejos, todos em um só lugar.'}</p><span className={`visibility-chip ${list.visibility === 'private' ? 'private-chip' : ''}`}>{list.visibility === 'private' ? <><Icon name="lock" size={12} /> Só você pode ver</> : <><Icon name="globe" size={12} /> Visível no seu perfil</>}</span></div><div className="detail-actions"><button className="button button-outline" onClick={onEdit}><Icon name="edit" size={16} /> Editar lista</button><button className="icon-button icon-button-plain" onClick={onDelete} aria-label="Excluir lista"><Icon name="trash" size={17} /></button></div></div>
    <div className="detail-subhead"><div><h2>Seus desejos <span>{list.items.length}</span></h2><p>Links para você e para quem quer te surpreender.</p></div><button className="button button-primary" onClick={onAdd}><Icon name="plus" size={17} /> Adicionar desejo</button></div>
    {list.items.length ? <div className="items-grid">{list.items.map((item, index) => <article className="wish-card" key={item.id}>
      <div className={`wish-image wish-image-${index % 4}`}>{item.image ? <img src={item.image} alt="" /> : <span>{['✿', '◌', '✧', '⌑'][index % 4]}</span>}{item.purchased && <span className="purchased-badge"><Icon name="check" size={13} /> Já comprei</span>}{item.reserved && <span className="reserved-badge"><Icon name="gift" size={13} /> Reservado</span>}</div>
      <div className="wish-info"><h3>{item.title}</h3><a href={item.url} target="_blank" rel="noreferrer" className="wish-link">{new URL(item.url).hostname.replace(/^www\./, '')}<Icon name="external" size={13} /></a>
        <div className="wish-actions"><button className={item.purchased ? 'wish-action purchased-action' : 'wish-action'} onClick={() => onPurchased(item.id)}><Icon name="check" size={15} />{item.purchased ? 'Comprado' : 'Marcar comprado'}</button><div><button className="mini-action" onClick={() => onEditItem(item)} aria-label={`Editar ${item.title}`}><Icon name="edit" size={15} /></button><button className="mini-action" onClick={() => onDeleteItem(item.id)} aria-label={`Excluir ${item.title}`}><Icon name="trash" size={15} /></button></div></div>
      </div>
    </article>)}</div> : <EmptyState title="Ainda não tem desejos por aqui" text="Adicione o primeiro produto que você gostaria de ganhar." action="Adicionar desejo" onClick={onAdd} />}
  </div>;
}

function ExplorePage({ query, peopleResults, listResults, onProfile, onClear, onList }) {
  return <div className="standard-page">
    <PageHeading eyebrow="ENCONTRE INSPIRAÇÃO" title={query ? 'Resultados da busca' : 'Explore'} description={query ? `O que encontramos para “${query}”.` : 'Descubra pessoas e listas para sua próxima ideia de presente.'} />
    {!query && <div className="explore-highlight"><span className="highlight-icon"><Icon name="search" size={22} /></span><div><strong>Tem alguém em mente?</strong><p>Busque pelo nome, @usuário ou por uma lista.</p></div><span className="highlight-spark">✳</span></div>}
    <div className="explore-section"><div className="section-heading"><div><div className="eyebrow">GENTE BOA</div><h2>Pessoas</h2></div><span className="result-count">{peopleResults.length} encontradas</span></div>
      {peopleResults.length ? <div className="people-grid">{peopleResults.map((person) => <button className="person-card" key={person.username} onClick={() => onProfile(person)}><Avatar person={person} /><span className="person-info"><strong>{person.name}</strong><small>@{person.username}</small><span>{person.visibility === 'private' ? 'Perfil privado' : person.bio}</span></span><Icon name="chevron" size={18} /></button>)}</div> : <div className="empty-inline">Nenhuma pessoa encontrada por enquanto.</div>}
    </div>
    {(query || listResults.length > 0) && <div className="explore-section"><div className="section-heading"><div><div className="eyebrow">LISTAS PÚBLICAS</div><h2>{query ? 'Listas' : 'Listas recentes'}</h2></div><span className="result-count">{listResults.length} {query ? 'encontradas' : 'disponíveis'}</span></div>
      {listResults.length ? <div className="public-list-results">{listResults.map((list) => <button key={list.id} onClick={() => onList(list)}><span className="result-list-icon"><Icon name="list" /></span><span><strong>{list.title}</strong><small>{list.items.length} desejos · por {list.owner.name}</small></span><Icon name="arrow" size={17} /></button>)}</div> : <div className="empty-inline">Nenhuma lista pública encontrada.</div>}
    </div>}
    {query && <button className="text-button clear-search" onClick={onClear}>Limpar busca <Icon name="close" size={15} /></button>}
    {!query && <div className="suggestion-strip"><span>FEITO PARA COMPARTILHAR</span><strong>Presentes que têm a cara de quem você gosta.</strong><p>Siga pessoas e acompanhe os desejos que elas adicionam.</p></div>}
  </div>;
}

function FollowingPage({ followedPeople, onProfile, onUnfollow, onExplore }) {
  return <div className="standard-page">
    <PageHeading eyebrow="SEU CÍRCULO" title="Seguindo" description="As pessoas cujas listas você acompanha." />
    {followedPeople.length ? <div className="following-list">{followedPeople.map((person) => <article className="following-card" key={person.username}><button className="following-person" onClick={() => onProfile(person)}><Avatar person={person} /><span><strong>{person.name}</strong><small>@{person.username} · {person.listsCount || 0} {person.listsCount === 1 ? 'lista pública' : 'listas públicas'}</small><span className="following-bio">{person.bio}</span></span></button><button className="button button-following" onClick={() => onUnfollow(person)}>Seguindo</button></article>)}</div> : <EmptyState title="Seu círculo começa com uma pessoa" text="Explore para encontrar alguém e acompanhar suas listas." action="Explorar pessoas" onClick={onExplore} />}
  </div>;
}

function ProfilePage({ person, followStatus, profileLocked, onFollow, onBack, onOpenList }) {
  const following = followStatus === 'accepted';
  const pending = followStatus === 'pending';
  return <div className="standard-page public-profile">
    <button className="back-link" onClick={onBack}><span className="back-arrow">←</span> Explorar</button>
    <div className="public-profile-card"><div className="profile-cover"><span>✿</span><span>✳</span><span>⌑</span></div><div className="profile-person-row"><Avatar person={person} /><button className={following || pending ? 'button button-following' : 'button button-primary'} onClick={onFollow}>{following ? 'Seguindo' : pending ? 'Pedido enviado' : <><Icon name="plus" size={16} /> {person.visibility === 'private' ? 'Pedir para seguir' : 'Seguir'}</>}</button></div><h1>{person.name}</h1><p className="username">@{person.username}</p><p className="profile-bio">{person.bio}</p>{!profileLocked && <div className="profile-stat"><strong>{person.lists.length}</strong><span>listas públicas</span><strong>{person.followersCount || 0}</strong><span>seguidores</span></div>}</div>
    {profileLocked ? <div className="private-profile-note"><Icon name="lock" size={16} /><span><strong>Perfil privado.</strong> Envie um pedido para acompanhar as listas desta pessoa.</span></div> : <>
    <div className="section-heading profile-lists-heading"><div><div className="eyebrow">PARA CONHECER</div><h2>Listas de {person.name.split(' ')[0]}</h2></div></div>
    <div className="my-lists-grid">{person.lists.map((list, index) => <article className={`my-list-card preview-${index % 3}`} key={list.title}><button className="my-list-open" onClick={() => onOpenList(list)}><div className="my-list-art"><span>{['✿', '⌑', '✳'][index % 3]}</span><span className="my-list-number">{list.items.length} itens</span></div><div className="my-list-info"><div className="visibility-chip"><Icon name="globe" size={12} /> Pública</div><h3>{list.title}</h3><p>Uma seleção especial de desejos.</p><div className="my-list-footer"><span>{list.items.length} desejos</span><Icon name="arrow" size={17} /></div></div></button></article>)}</div>
    </>}
  </div>;
}

function PublicListDetail({ person, list, onBack, onCopy, onReserve }) {
  const items = list.items || [];
  return <div className="standard-page">
    <button className="back-link" onClick={onBack}><span className="back-arrow">←</span> Perfil de {person.name.split(' ')[0]}</button>
    <div className="list-detail-heading"><div><div className="eyebrow">LISTA PÚBLICA DE @{person.username}</div><h1>{list.title}</h1><p>Uma seleção especial de desejos.</p><span className="visibility-chip"><Icon name="globe" size={12} /> Pública</span></div></div>
    <div className="detail-subhead"><div><h2>Desejos <span>{items.length}</span></h2><p>Escolha uma ideia ou guarde na sua lista.</p></div></div>
    {items.length ? <div className="items-grid">{items.map((item, index) => {
      const reserved = item.reserved;
      return <article className="wish-card" key={item.id}>
        <div className={`wish-image wish-image-${index % 4}`}>{item.image ? <img src={item.image} alt="" /> : <span>{['✿', '◌', '✧', '⌑'][index % 4]}</span>}{item.purchased && <span className="purchased-badge"><Icon name="check" size={13} /> Já comprado</span>}{reserved && <span className="reserved-badge"><Icon name="gift" size={13} /> Reservado</span>}</div>
        <div className="wish-info"><h3>{item.title}</h3><a href={item.url} target="_blank" rel="noreferrer" className="wish-link">{new URL(item.url).hostname.replace(/^www\./, '')}<Icon name="external" size={13} /></a>
          <div className="public-wish-actions"><button className="wish-action" disabled={item.purchased || (reserved && !item.reservedByMe)} onClick={() => onReserve(item)}><Icon name="gift" size={15} />{item.purchased ? 'Já comprado' : item.reservedByMe ? 'Cancelar reserva' : reserved ? 'Já reservado' : 'Vou presentear'}</button><button className="mini-action" onClick={() => onCopy(item)} aria-label={`Adicionar ${item.title} à minha lista`} title="Adicionar à minha lista"><Icon name="plus" size={16} /></button></div>
        </div>
      </article>;
    })}</div> : <EmptyState title="Essa lista ainda está vazia" text="Volte mais tarde para ver novos desejos." />}
    <p className="reservation-note"><Icon name="lock" size={14} /> A reserva aparece como “Reservado”, sem mostrar quem reservou.</p>
  </div>;
}

function MyProfile({ lists, profile, requests, onList, onEdit, onNew, onLogout, onAvatar, onRemoveAvatar, onRespondToRequest }) {
  const visibleLists = lists.filter((list) => list.visibility === 'public');
  return <div className="standard-page public-profile">
    <div className="my-profile-card"><div className="profile-cover own-cover"><span>✿</span><span>✳</span><span>⌑</span></div><div className="profile-person-row"><Avatar person={profile} /><div className="profile-actions"><label className="button button-outline avatar-upload">Alterar foto<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { if (event.target.files?.[0]) onAvatar(event.target.files[0]); event.target.value = ''; }} /></label>{profile.avatarUrl && <button className="button button-quiet" onClick={onRemoveAvatar}>Remover foto</button>}<button className="button button-outline" onClick={onEdit}><Icon name="edit" size={16} /> Editar perfil</button></div></div><h1>{profile.name}</h1><p className="username">@{profile.username}</p><p className="profile-bio">{profile.bio}</p><div className="profile-stat"><strong>{visibleLists.length}</strong><span>listas públicas</span><strong>{profile.followersCount || 0}</strong><span>seguidores</span><span className="profile-visibility">{profile.visibility === 'private' ? <><Icon name="lock" size={12} /> Perfil privado</> : <><Icon name="globe" size={12} /> Perfil público</>}</span></div><button className="button button-quiet logout-button" onClick={onLogout}>Sair da conta</button></div>
    {requests.length > 0 && <section className="follow-requests"><div className="section-heading"><div><div className="eyebrow">SEU CÍRCULO</div><h2>Pedidos para seguir <span>{requests.length}</span></h2></div></div>{requests.map((request) => <article className="follow-request" key={request.id}><Avatar person={request} small /><div className="follow-request-person"><strong>{request.name}</strong><small>@{request.username}</small></div><button className="button button-primary" onClick={() => onRespondToRequest(request, true)}>Aceitar</button><button className="button button-quiet" onClick={() => onRespondToRequest(request, false)}>Recusar</button></article>)}</section>}
    <div className="section-heading profile-lists-heading"><div><div className="eyebrow">VISÍVEL PARA SEU CÍRCULO</div><h2>Suas listas públicas</h2></div><button className="text-button" onClick={onNew}><Icon name="plus" size={16} /> Nova lista</button></div>
    {visibleLists.length ? <div className="my-lists-grid">{visibleLists.map((list, index) => <article className={`my-list-card preview-${index % 3}`} key={list.id}><button className="my-list-open" onClick={() => onList(list.id)}><div className="my-list-art"><span>{['✿', '⌑', '✳'][index % 3]}</span><span className="my-list-number">{list.items.length} itens</span></div><div className="my-list-info"><div className="visibility-chip"><Icon name="globe" size={12} /> Pública</div><h3>{list.title}</h3><p>{list.description || 'Uma seleção especial de desejos.'}</p><div className="my-list-footer"><span>{list.items.length} desejos</span><Icon name="arrow" size={17} /></div></div></button></article>)}</div> : <EmptyState title="Seu perfil ainda está vazio" text="Crie uma lista pública para compartilhar seus desejos." action="Criar uma lista" onClick={onNew} />}
    {lists.some((list) => list.visibility === 'private') && <div className="private-profile-note"><Icon name="lock" size={16} /><span><strong>Você também tem listas privadas.</strong> Só você pode vê-las em Minhas listas.</span></div>}
  </div>;
}

function EmptyState({ title, text, action, onClick }) {
  return <div className="empty-state"><span className="empty-art"><Icon name="heart" size={26} /></span><h2>{title}</h2><p>{text}</p>{action && <button className="button button-primary" onClick={onClick}><Icon name="plus" size={16} />{action}</button>}</div>;
}

function Modal({ children, onClose }) {
  useEffect(() => {
    function onKeyDown(event) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-panel" role="dialog" aria-modal="true">{children}<button className="modal-close" onClick={onClose} aria-label="Fechar"><Icon name="close" size={18} /></button></div></div>;
}

export default App;
