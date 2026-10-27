import { useEffect, useRef, useState } from 'react';
import {
  Orbit, Plus, MessageSquare, Image as ImageIcon, Send, Paperclip,
  Sparkles, LogIn, LogOut, Share2, Menu, X, LoaderCircle, User,
  ArrowUpRight, WandSparkles
} from 'lucide-react';

const starters = [
  { icon: '✦', title: 'Explain something', prompt: 'Explain quantum computing in simple language, with an everyday example.' },
  { icon: '▧', title: 'Understand a photo', prompt: 'I want to upload a photo and understand what is in it.' },
  { icon: '✧', title: 'Create an image', prompt: 'A dreamy galaxy with glowing planets and soft purple light.' },
  { icon: '⌘', title: 'Help me write', prompt: 'Help me write a clear, friendly message.' }
];

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('orbit_token') || '');
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('orbit_user') || 'null'); } catch { return null; }
  });
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState('');
  const [notice, setNotice] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mode, setMode] = useState('chat');
  const [currentChatId, setCurrentChatId] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('signup');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authBusy, setAuthBusy] = useState(false);
  const fileRef = useRef(null);
  const bottomRef = useRef(null);

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  useEffect(() => {
    if (token) {
      api('/api/me').then(data => { setUser(data.user); localStorage.setItem('orbit_user', JSON.stringify(data.user)); loadHistory(); })
        .catch(() => signOut(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy, imageBusy]);

  async function loadHistory() {
    try { const data = await api('/api/chats'); setHistory(data.chats || []); } catch {}
  }

  async function handleAuth(e) {
    e.preventDefault();
    setAuthBusy(true); setNotice('');
    try {
      const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const data = await api(endpoint, { method: 'POST', body: JSON.stringify(authForm) });
      setToken(data.token); setUser(data.user);
      localStorage.setItem('orbit_token', data.token);
      localStorage.setItem('orbit_user', JSON.stringify(data.user));
      setAuthOpen(false); setAuthForm({ name: '', email: '', password: '' });
      setNotice(`Welcome${data.user.name ? ', ' + data.user.name : ''}!`);
      await loadHistory();
    } catch (e) { setNotice(e.message); }
    finally { setAuthBusy(false); }
  }

  function signOut(showNotice = true) {
    setToken(''); setUser(null); setHistory([]); setMessages([]); setCurrentChatId('');
    localStorage.removeItem('orbit_token'); localStorage.removeItem('orbit_user');
    if (showNotice) setNotice('You have signed out.');
  }

  function openAuth(mode = 'signup') { setAuthMode(mode); setAuthOpen(true); setNotice(''); }

  function newChat() {
    setMessages([]); setInput(''); setAttachment(null); setAttachmentPreview('');
    setCurrentChatId(''); setMode('chat'); setNotice(''); setSidebarOpen(false);
  }

  function chooseFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setNotice('Please choose an image file.');
    if (file.size > 8 * 1024 * 1024) return setNotice('Please choose an image smaller than 8 MB.');
    setAttachment(file); setAttachmentPreview(URL.createObjectURL(file)); setNotice('');
  }

  function imageToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ data: String(reader.result).split(',')[1], mimeType: file.type || 'image/jpeg' });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function sendMessage(override) {
    const text = (override ?? input).trim();
    if ((!text && !attachment) || busy) return;
    if (!token) return openAuth('signup');
    setBusy(true); setNotice('');
    const file = attachment;
    const shownMessages = [...messages, { role: 'user', content: text || 'Please describe this image.', imageUrl: attachmentPreview || undefined }];
    setMessages(shownMessages); setInput(''); setAttachment(null); setAttachmentPreview('');
    try {
      const image = file ? await imageToBase64(file) : undefined;
      const data = await api('/api/chat', { method: 'POST', body: JSON.stringify({
        message: text || 'Please describe this image and answer any useful questions about it.',
        history: messages.slice(-12).map(m => ({ role: m.role, content: m.content })),
        image, chatId: currentChatId || undefined
      }) });
      setMessages([...shownMessages, { role: 'assistant', content: data.answer }]);
      if (data.chatId) setCurrentChatId(data.chatId);
      await loadHistory();
    } catch (e) {
      setMessages([...shownMessages, { role: 'assistant', content: 'I could not answer that just now. Please try again.' }]);
      setNotice(e.message);
    } finally { setBusy(false); }
  }

  async function createImage(override) {
    const prompt = (override ?? input).trim();
    if (!prompt || imageBusy) return;
    if (!token) return openAuth('signup');
    setImageBusy(true); setNotice('');
    const shownMessages = [...messages, { role: 'user', content: 'Create an image: ' + prompt }];
    setMessages(shownMessages); setInput('');
    try {
      const data = await api('/api/image', { method: 'POST', body: JSON.stringify({ prompt }) });
      setMessages([...shownMessages, { role: 'assistant', content: 'Your image is ready. ✨', imageUrl: `data:${data.mimeType};base64,${data.data}` }]);
    } catch (e) { setNotice(e.message); setMessages([...shownMessages, { role: 'assistant', content: 'I could not create that image right now. Please try again.' }]); }
    finally { setImageBusy(false); }
  }

  async function openChat(chat) {
    try {
      const data = await api(`/api/chats/${chat.id}`);
      setCurrentChatId(chat.id); setMessages(data.messages || []); setSidebarOpen(false); setNotice('');
    } catch (e) { setNotice(e.message); }
  }

  function shareChat() {
    if (!messages.length) return setNotice('Start a conversation first, then you can share it.');
    const shareText = 'My conversation with Orbit\n\n' + messages.map(m => `${m.role === 'user' ? 'You' : 'Orbit'}: ${m.content}`).join('\n\n');
    if (navigator.share) navigator.share({ title: 'My Orbit conversation', text: shareText }).catch(() => {});
    else navigator.clipboard?.writeText(shareText).then(() => setNotice('Conversation copied. You can paste it anywhere.')).catch(() => setNotice('Could not copy automatically.'));
  }

  return <div className="app-shell">
    {sidebarOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Orbit size={22} strokeWidth={2.3} /></div><span>orbit</span><span className="brand-beta">AI</span></div>
      <button className="new-chat" onClick={newChat}><Plus size={17} /> New conversation <span>＋</span></button>
      <div className="side-label">YOUR SPACE</div>
      <button className="side-link active" onClick={newChat}><MessageSquare size={17} /> Chat with Orbit</button>
      <button className="side-link" onClick={() => { setMode('image'); setSidebarOpen(false); }}><WandSparkles size={17} /> Create an image <span className="tiny-spark">✦</span></button>
      <div className="side-label history-label">RECENT</div>
      <div className="history-list">{history.map(chat => <button key={chat.id} className={`history-item ${currentChatId === chat.id ? 'selected' : ''}`} onClick={() => openChat(chat)}><MessageSquare size={15} /><span>{chat.title || 'New conversation'}</span></button>)}
        {!history.length && <p className="empty-history">Your saved conversations will appear here.</p>}
      </div>
      <div className="sidebar-bottom">
        <div className="orbit-note"><Sparkles size={15} /><span>A little more curious.<br />A lot more capable.</span></div>
        {user ? <button className="profile-row" onClick={() => signOut()}><div className="avatar">{(user.name || user.email || 'O').charAt(0).toUpperCase()}</div><div className="profile-copy"><strong>{user.name || 'Orbit user'}</strong><span>{user.email}</span></div><LogOut size={16} /></button>
          : <button className="profile-row" onClick={() => openAuth('signup')}><div className="avatar"><User size={17} /></div><div className="profile-copy"><strong>Sign in to Orbit</strong><span>Save your conversations</span></div><LogIn size={16} /></button>}
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
        <div className="topbar-title"><span className="online-dot" /> Your AI space <span className="topbar-divider">/</span> <span>{mode === 'image' ? 'Image studio' : 'Assistant'}</span></div>
        <div className="top-actions"><button className="share-button" onClick={shareChat} disabled={!messages.length}><Share2 size={15} /><span>Share</span></button>
          {!user && <button className="sign-in-button" onClick={() => openAuth('login')}><LogIn size={15} /> Sign in</button>}</div>
      </header>
      <section className={`conversation ${messages.length ? 'has-messages' : 'welcome-view'}`}>
        {!messages.length ? <div className="welcome-content">
          <div className="hero-orbit"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="hero-core"><Orbit size={31} /></div><span className="orbit-point point-one" /><span className="orbit-point point-two" /><span className="orbit-point point-three" /></div>
          <div className="eyebrow"><span /> YOUR IDEAS, IN ORBIT</div>
          <h1>Big questions.<br /><span>Clear answers.</span></h1>
          <p className="hero-copy">Meet Orbit — your space to explore ideas, understand images, create something new, and figure things out. Just ask naturally.</p>
          <div className="starter-grid">{starters.map(item => <button className="starter-card" key={item.title} onClick={() => item.title === 'Create an image' ? (setMode('image'), setInput(item.prompt)) : item.title === 'Understand a photo' ? fileRef.current?.click() : setInput(item.prompt)}>
            <span className="starter-icon">{item.icon}</span><span className="starter-text"><strong>{item.title}</strong><small>{item.title === 'Explain something' ? 'Simple, step-by-step answers' : item.title === 'Understand a photo' ? 'Upload and ask about it' : item.title === 'Create an image' ? 'Turn words into visuals' : 'Find the right words'}</small></span><ArrowUpRight size={16} className="starter-arrow" /></button>)}</div>
          <div className="welcome-foot"><Sparkles size={14} /> Helpful by design. Curious by nature.</div>
        </div> : <div className="message-list"><div className="thread-label"><span className="thread-line" /> CONVERSATION <span className="thread-line" /></div>
          {messages.map((message, index) => <div className={`message-row ${message.role === 'user' ? 'user-row' : ''}`} key={index}>
            <div className={`message-avatar ${message.role === 'assistant' ? 'orbit-avatar' : 'user-avatar'}`}>{message.role === 'assistant' ? <Orbit size={17} /> : <User size={16} />}</div>
            <div className="message-body"><div className="message-author">{message.role === 'assistant' ? 'Orbit' : 'You'} <span>{message.role === 'assistant' ? 'AI ASSISTANT' : 'YOU'}</span></div>
              {message.imageUrl && <img className="message-image" src={message.imageUrl} alt={message.role === 'user' ? 'Uploaded image' : 'AI generated image'} />}
              <div className="message-text">{message.content}</div></div></div>)}
          {(busy || imageBusy) && <div className="message-row"><div className="message-avatar orbit-avatar"><Orbit size={17} /></div><div className="message-body"><div className="message-author">Orbit <span>THINKING</span></div><div className="thinking"><LoaderCircle size={16} className="spin" /> {imageBusy ? 'Dreaming up your image…' : 'Putting the pieces together…'}</div></div></div>}
          <div ref={bottomRef} /></div>}
      </section>
      <div className="composer-wrap">
        {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={14} /></button></div>}
        {attachmentPreview && <div className="attachment-preview"><img src={attachmentPreview} alt="Selected upload" /><div><strong>{attachment?.name}</strong><small>Ready to send to Orbit</small></div><button onClick={() => { setAttachment(null); setAttachmentPreview(''); }} aria-label="Remove image"><X size={16} /></button></div>}
        <div className="mode-switch"><button className={mode === 'chat' ? 'mode-active' : ''} onClick={() => setMode('chat')}><MessageSquare size={14} /> Ask Orbit</button><button className={mode === 'image' ? 'mode-active' : ''} onClick={() => setMode('image')}><ImageIcon size={14} /> Create image</button></div>
        <div className="composer"><button className="attach-button" aria-label="Attach image" onClick={() => fileRef.current?.click()}><Paperclip size={19} /></button>
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mode === 'image' ? createImage() : sendMessage(); } }} placeholder={mode === 'image' ? 'Describe the image you want to create…' : 'Ask Orbit anything…'} rows={1} />
          <button className={`send-button ${input.trim() || attachment ? 'send-ready' : ''}`} disabled={busy || imageBusy || (!input.trim() && !attachment)} onClick={() => mode === 'image' ? createImage() : sendMessage()} aria-label={mode === 'image' ? 'Create image' : 'Send message'}>{busy || imageBusy ? <LoaderCircle size={18} className="spin" /> : mode === 'image' ? <WandSparkles size={18} /> : <Send size={18} />}</button></div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => chooseFile(e.target.files?.[0])} />
        <div className="composer-caption"><span>Orbit can make mistakes. Double-check important information.</span><span><span className="secure-dot" /> Private workspace</span></div>
      </div>
    </main>
    {authOpen && <div className="modal-backdrop" onClick={() => setAuthOpen(false)}><div className="auth-modal" onClick={e => e.stopPropagation()}>
      <button className="modal-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={18} /></button>
      <div className="modal-logo"><Orbit size={22} /></div><h2>{authMode === 'signup' ? 'Create your Orbit account' : 'Welcome back'}</h2><p>{authMode === 'signup' ? 'Save your conversations and make more room for ideas.' : 'Sign in to continue your conversations.'}</p>
      <form onSubmit={handleAuth}>{authMode === 'signup' && <label>Your name<input autoComplete="name" value={authForm.name} onChange={e => setAuthForm({ ...authForm, name: e.target.value })} required /></label>}
        <label>Email address<input type="email" autoComplete="email" value={authForm.email} onChange={e => setAuthForm({ ...authForm, email: e.target.value })} required /></label>
        <label>Password<input type="password" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} minLength={8} value={authForm.password} onChange={e => setAuthForm({ ...authForm, password: e.target.value })} required /></label>
        <button className="auth-submit" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Sign in'}</button></form>
      <div className="auth-switch">{authMode === 'signup' ? 'Already have an account?' : 'New to Orbit?'} <button onClick={() => setAuthMode(authMode === 'signup' ? 'login' : 'signup')}>{authMode === 'signup' ? 'Sign in' : 'Create account'}</button></div>
    </div></div>}
  </div>;
}

export default App;
