import { useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getAuthProviders } from '../services/authApi'
import './Pages.css'

const ACCESS_MODES = {
  login: 'login',
  register: 'register',
  verify: 'verify',
  mfa: 'mfa',
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID ?? ''
const APPLE_REDIRECT_URI = import.meta.env.VITE_APPLE_REDIRECT_URI ?? ''

const scriptLoadCache = new Map()

function loadExternalScript(src, checkGlobal) {
  if (checkGlobal()) return Promise.resolve()

  if (scriptLoadCache.has(src)) {
    return scriptLoadCache.get(src)
  }

  const promise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`)

    const onReady = () => {
      if (checkGlobal()) {
        resolve()
        return
      }

      reject(new Error('No se pudo cargar el proveedor de autenticacion.'))
    }

    if (existingScript) {
      existingScript.addEventListener('load', onReady, { once: true })
      existingScript.addEventListener('error', () => {
        reject(new Error('Fallo al cargar el script de autenticacion.'))
      }, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.onload = onReady
    script.onerror = () => {
      reject(new Error('Fallo al cargar el script de autenticacion.'))
    }
    document.head.appendChild(script)
  })

  scriptLoadCache.set(src, promise)
  return promise
}

function requestGoogleIdToken(clientId) {
  return new Promise((resolve, reject) => {
    const googleApi = window.google?.accounts?.id
    if (!googleApi) {
      reject(new Error('Google Identity Services no esta disponible.'))
      return
    }

    let settled = false
    const finish = (handler) => (value) => {
      if (settled) return
      settled = true
      handler(value)
    }

    const resolveOnce = finish(resolve)
    const rejectOnce = finish(reject)

    googleApi.initialize({
      client_id: clientId,
      auto_select: false,
      cancel_on_tap_outside: false,
      // Fallback al flujo clasico para evitar fallos FedCM en algunos webviews/entornos locales.
      use_fedcm_for_prompt: false,
      use_fedcm_for_button: false,
      callback: (response) => {
        const credential = response?.credential
        if (!credential) {
          rejectOnce(new Error('Google no devolvio una credencial valida.'))
          return
        }

        resolveOnce(credential)
      },
    })

    googleApi.prompt((notification) => {
      if (settled) return

      const notDisplayed =
        typeof notification?.isNotDisplayed === 'function' && notification.isNotDisplayed()
      const skipped =
        typeof notification?.isSkippedMoment === 'function' && notification.isSkippedMoment()
      const dismissed =
        typeof notification?.isDismissedMoment === 'function' && notification.isDismissedMoment()

      if (notDisplayed || skipped || dismissed) {
        rejectOnce(new Error('No se completo el acceso con Google. Intenta otra vez.'))
      }
    })

    setTimeout(() => {
      if (settled) return
      rejectOnce(new Error('Tiempo agotado al esperar respuesta de Google.'))
    }, 20000)
  })
}

async function requestAppleIdentity({ clientId, redirectUri }) {
  const apple = window.AppleID

  if (!apple?.auth?.init || !apple?.auth?.signIn) {
    throw new Error('Apple Sign In no esta disponible en este navegador.')
  }

  apple.auth.init({
    clientId,
    scope: 'name email',
    redirectURI: redirectUri || `${window.location.origin}/acceso`,
    state: `vensur_${Date.now()}`,
    nonce: `nonce_${Date.now()}`,
    usePopup: true,
  })

  const response = await apple.auth.signIn()
  const idToken = response?.authorization?.id_token

  if (!idToken) {
    throw new Error('Apple no devolvio un token valido.')
  }

  return {
    idToken,
    firstName: response?.user?.name?.firstName ?? '',
    lastName: response?.user?.name?.lastName ?? '',
  }
}

function sanitizeText(value) {
  return value.trim()
}

function normalizeEmail(value) {
  return sanitizeText(value).toLowerCase()
}

function getPasswordStrength(password) {
  if (!password) return 0

  let score = 0
  if (password.length >= 8) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)) score += 1
  if (/[^a-z0-9]/i.test(password) && password.length >= 10) score += 1

  return Math.min(3, score)
}

export default function AccesoPage() {
  const location = useLocation()
  const {
    isAuthenticated,
    isBooting,
    isAuthBusy,
    authError,
    verificationChallenge,
    mfaLoginChallenge,
    clearAuthError,
    clearVerificationChallenge,
    clearMfaLoginChallenge,
    login,
    loginWithApple,
    loginWithGoogle,
    register,
    resendVerificationCode,
    verifyMfaLoginCode,
    verifyEmailCode,
  } = useAuth()

  const [mode, setMode] = useState(ACCESS_MODES.login)
  const [loginForm, setLoginForm] = useState({
    identifier: '',
    password: '',
  })
  const [registerForm, setRegisterForm] = useState({
    email: '',
    username: '',
    displayName: '',
    password: '',
    confirmPassword: '',
  })
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showRegisterPassword, setShowRegisterPassword] = useState(false)
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [oauthProviderLoading, setOauthProviderLoading] = useState('')
  const [providerConfig, setProviderConfig] = useState({
    google: { enabled: false, clientId: '' },
    apple: { enabled: false, clientId: '' },
  })
  const [verifyForm, setVerifyForm] = useState({
    email: '',
    code: '',
  })
  const [mfaForm, setMfaForm] = useState({
    code: '',
  })
  const [verificationHint, setVerificationHint] = useState('')
  const [providersResolved, setProvidersResolved] = useState(false)
  const [localError, setLocalError] = useState('')
  const challengeEmail = verificationChallenge?.email ?? ''
  const verifyEmailValue = verifyForm.email || challengeEmail
  const fallbackVerificationHint = challengeEmail
    ? verificationChallenge?.debugVerificationCode
      ? `Codigo de verificacion (desarrollo): ${verificationChallenge.debugVerificationCode}`
      : 'Te enviamos un codigo de verificacion a tu correo.'
    : ''
  const panelVerificationHint = verificationHint || fallbackVerificationHint
  const mfaHint = typeof mfaLoginChallenge?.hint === 'string' ? mfaLoginChallenge.hint : ''

  const redirectPath = useMemo(() => {
    const from = location.state?.from
    if (typeof from === 'string' && from) return from
    if (from?.pathname) return from.pathname
    return '/perfil'
  }, [location.state])
  const activeMode = mfaLoginChallenge?.mfaToken
    ? ACCESS_MODES.mfa
    : verificationChallenge?.email
      ? ACCESS_MODES.verify
      : mode

  useEffect(() => {
    let isMounted = true

    async function loadProviderConfig() {
      try {
        const response = await getAuthProviders()
        if (!isMounted) return

        setProviderConfig({
          google: {
            enabled: Boolean(response?.google?.enabled),
            clientId: typeof response?.google?.clientId === 'string' ? response.google.clientId : '',
          },
          apple: {
            enabled: Boolean(response?.apple?.enabled),
            clientId: typeof response?.apple?.clientId === 'string' ? response.apple.clientId : '',
          },
        })
        setProvidersResolved(true)
      } catch {
        if (!isMounted) return
        setProvidersResolved(false)
      }
    }

    loadProviderConfig()

    return () => {
      isMounted = false
    }
  }, [])

  if (isBooting) {
    return (
      <section className="feed route-page access-page">
        <p className="route-message">Verificando sesion...</p>
      </section>
    )
  }

  if (isAuthenticated) {
    return <Navigate to={redirectPath} replace />
  }

  const handleMode = (nextMode) => () => {
    setMode(nextMode)
    setLocalError('')
    clearAuthError()

    if (nextMode !== ACCESS_MODES.verify) {
      setVerificationHint('')
    }

    if (nextMode === ACCESS_MODES.login) {
      clearVerificationChallenge()
      clearMfaLoginChallenge()
    }
  }

  const onLoginField = (field) => (event) => {
    const value = event.target.value
    setLoginForm((current) => ({ ...current, [field]: value }))
  }

  const onRegisterField = (field) => (event) => {
    const value = event.target.value
    setRegisterForm((current) => ({ ...current, [field]: value }))
  }

  const onVerifyField = (field) => (event) => {
    const value = event.target.value
    setVerifyForm((current) => ({ ...current, [field]: value }))
  }

  const onMfaField = (field) => (event) => {
    const value = event.target.value
    setMfaForm((current) => ({ ...current, [field]: value }))
  }

  const handleLoginSubmit = async (event) => {
    event.preventDefault()
    setLocalError('')

    const identifier = sanitizeText(loginForm.identifier)
    const password = loginForm.password

    if (!identifier || !password) {
      setLocalError('Completa usuario/correo y clave')
      return
    }

    const user = await login({ identifier, password })
    if (!user) return

    setLoginForm({ identifier: '', password: '' })
  }

  const handleRegisterSubmit = async (event) => {
    event.preventDefault()
    setLocalError('')

    const email = sanitizeText(registerForm.email)
    const username = sanitizeText(registerForm.username)
    const displayName = sanitizeText(registerForm.displayName)
    const password = registerForm.password
    const confirmPassword = registerForm.confirmPassword

    if (!email || !username || !password) {
      setLocalError('Completa correo, usuario y clave')
      return
    }

    if (password.length < 8) {
      setLocalError('La clave debe tener al menos 8 caracteres')
      return
    }

    if (password !== confirmPassword) {
      setLocalError('Las claves no coinciden')
      return
    }

    if (!termsAccepted) {
      setLocalError('Debes aceptar Terminos y Privacidad para continuar')
      return
    }

    const user = await register({
      email,
      username,
      displayName,
      password,
    })

    if (!user) return

    setRegisterForm({
      email: '',
      username: '',
      displayName: '',
      password: '',
      confirmPassword: '',
    })
    setTermsAccepted(false)
  }

  const handleVerifySubmit = async (event) => {
    event.preventDefault()
    setLocalError('')

    const email = normalizeEmail(verifyEmailValue)
    const code = sanitizeText(verifyForm.code)

    if (!email || !code) {
      setLocalError('Completa correo y codigo de verificacion')
      return
    }

    if (!/^\d{6}$/.test(code)) {
      setLocalError('El codigo debe tener 6 digitos')
      return
    }

    const user = await verifyEmailCode({ email, code })
    if (!user) return

    setVerifyForm({ email: '', code: '' })
    setVerificationHint('')
  }

  const handleMfaSubmit = async (event) => {
    event.preventDefault()
    setLocalError('')

    const mfaToken = typeof mfaLoginChallenge?.mfaToken === 'string' ? mfaLoginChallenge.mfaToken : ''
    const code = sanitizeText(mfaForm.code).replace(/\D/g, '').slice(0, 6)

    if (!mfaToken) {
      setLocalError('El desafio MFA no es valido. Inicia sesion nuevamente.')
      return
    }

    if (!/^\d{6}$/.test(code)) {
      setLocalError('El codigo MFA debe tener 6 digitos')
      return
    }

    const user = await verifyMfaLoginCode({ mfaToken, code })
    if (!user) return

    setMfaForm({ code: '' })
  }

  const handleResendCode = async () => {
    const email = normalizeEmail(verifyEmailValue)
    if (!email) {
      setLocalError('Indica tu correo para reenviar el codigo')
      return
    }

    setLocalError('')
    const wasResent = await resendVerificationCode(email)

    if (wasResent) {
      setVerificationHint('Te reenviamos un nuevo codigo de verificacion.')
    }
  }

  const panelError = localError || authError
  const passwordStrength = getPasswordStrength(registerForm.password)

  const toggleLoginPassword = () => setShowLoginPassword((current) => !current)
  const toggleRegisterPassword = () => setShowRegisterPassword((current) => !current)
  const toggleRegisterConfirmPassword = () => setShowRegisterConfirmPassword((current) => !current)

  const googleClientId = providerConfig.google.clientId || GOOGLE_CLIENT_ID
  const appleClientId = providerConfig.apple.clientId || APPLE_CLIENT_ID

  const handleGoogleLogin = async () => {
    if (isAuthBusy || oauthProviderLoading) return

    setLocalError('')
    clearAuthError()

    if (providersResolved && !providerConfig.google.enabled) {
      setLocalError('Google OAuth no esta habilitado en la API. Define GOOGLE_CLIENT_ID en .env y reinicia la API.')
      return
    }

    if (!googleClientId) {
      setLocalError('Google OAuth no esta configurado. Define GOOGLE_CLIENT_ID y/o VITE_GOOGLE_CLIENT_ID.')
      return
    }

    try {
      setOauthProviderLoading('google')

      await loadExternalScript('https://accounts.google.com/gsi/client', () => {
        return Boolean(window.google?.accounts?.id)
      })

      const idToken = await requestGoogleIdToken(googleClientId)
      await loginWithGoogle(idToken)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'No se pudo iniciar con Google.')
    } finally {
      setOauthProviderLoading('')
    }
  }

  const handleAppleLogin = async () => {
    if (isAuthBusy || oauthProviderLoading) return

    setLocalError('')
    clearAuthError()

    if (providersResolved && !providerConfig.apple.enabled) {
      setLocalError('Apple Sign In no esta habilitado en la API. Define APPLE_CLIENT_ID en .env y reinicia la API.')
      return
    }

    if (!appleClientId) {
      setLocalError('Apple Sign In no esta configurado. Define APPLE_CLIENT_ID y/o VITE_APPLE_CLIENT_ID.')
      return
    }

    try {
      setOauthProviderLoading('apple')

      await loadExternalScript(
        'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
        () => Boolean(window.AppleID?.auth?.init),
      )

      const identity = await requestAppleIdentity({
        clientId: appleClientId,
        redirectUri: APPLE_REDIRECT_URI,
      })

      await loginWithApple(identity)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'No se pudo iniciar con Apple.')
    } finally {
      setOauthProviderLoading('')
    }
  }

  return (
    <section className="feed route-page access-page">
      <div className="access-flagbar" />

      <div className="access-shell">
        <aside className="access-brandside" aria-label="Identidad de marca">
          <div className="access-brandmark">
            <div className="access-brand-ring" />
            <b>VENEZUELA EN SU REALIDAD</b>
          </div>

          <div className="access-brandmain">
            <h1>
              Historias y denuncias que no van a <span>quedarse calladas.</span>
            </h1>
            <p>
              Sumate a una comunidad que documenta, comparte y no olvida lo que pasa en Venezuela,
              en tiempo real y desde el territorio.
            </p>

            <div className="access-stackpreview">
              <div className="access-av"><div className="access-av-in" /></div>
              <div className="access-av"><div className="access-av-in" /></div>
              <div className="access-av"><div className="access-av-in" /></div>
              <div className="access-av"><div className="access-av-in" /></div>
              <span>+18.4K ciudadanos ya publicaron esta semana</span>
            </div>
          </div>

          <div className="access-brandfoot">
            <div>
              <b>1,204</b>
              <span>PUBLICACIONES HOY</span>
            </div>
            <div>
              <b>312</b>
              <span>DENUNCIAS ACTIVAS</span>
            </div>
            <div>
              <b>24</b>
              <span>TRANSMISIONES EN VIVO</span>
            </div>
          </div>
        </aside>

        <section className="access-formside" aria-label="Formulario de acceso">
          <div className="access-formwrap">
            <div className="access-switchtabs" role="tablist" aria-label="Modo de acceso">
              <button
                className={activeMode === ACCESS_MODES.login ? 'active' : ''}
                onClick={handleMode(ACCESS_MODES.login)}
                type="button"
              >
                Iniciar sesion
              </button>
              <button
                className={activeMode === ACCESS_MODES.register ? 'active' : ''}
                onClick={handleMode(ACCESS_MODES.register)}
                type="button"
              >
                Crear cuenta
              </button>
            </div>

            {panelError ? <p className="access-error">{panelError}</p> : null}
            {panelVerificationHint ? <p className="access-note">{panelVerificationHint}</p> : null}

            {activeMode === ACCESS_MODES.login ? (
              <div className="access-pane active" id="pane-login">
                <h2>Bienvenido de nuevo</h2>
                <p className="access-sub">Entra para ver lo que esta pasando ahora mismo.</p>

                <form onSubmit={handleLoginSubmit}>
                  <div className="access-field">
                    <label>Correo o usuario</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">✉</span>
                      <input
                        autoComplete="username"
                        onChange={onLoginField('identifier')}
                        placeholder="tu@correo.com"
                        value={loginForm.identifier}
                      />
                    </div>
                  </div>

                  <div className="access-field">
                    <label>Contrasena</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">🔒</span>
                      <input
                        autoComplete="current-password"
                        onChange={onLoginField('password')}
                        placeholder="••••••••"
                        type={showLoginPassword ? 'text' : 'password'}
                        value={loginForm.password}
                      />
                      <button className="access-toggle" onClick={toggleLoginPassword} type="button">
                        {showLoginPassword ? 'OCULTAR' : 'MOSTRAR'}
                      </button>
                    </div>
                  </div>

                  <div className="access-rowbetween">
                    <label className="access-checkline">
                      <input
                        checked={rememberMe}
                        onChange={(event) => setRememberMe(event.target.checked)}
                        type="checkbox"
                      />
                      Recordarme
                    </label>
                    <button className="access-linklike" type="button">
                      Olvidaste tu contrasena?
                    </button>
                  </div>

                  <button className="access-submitbtn" disabled={isAuthBusy} type="submit">
                    {isAuthBusy ? 'Entrando...' : 'Entrar'}
                  </button>

                  <div className="access-divider">O CONTINUA CON</div>
                  <div className="access-oauth">
                    <button
                      disabled={isAuthBusy || Boolean(oauthProviderLoading)}
                      onClick={handleGoogleLogin}
                      type="button"
                    >
                      {oauthProviderLoading === 'google' ? 'Conectando Google...' : '🔵 Continuar con Google'}
                    </button>
                    <button
                      disabled={isAuthBusy || Boolean(oauthProviderLoading)}
                      onClick={handleAppleLogin}
                      type="button"
                    >
                      {oauthProviderLoading === 'apple' ? 'Conectando Apple...' : '🍎 Continuar con Apple'}
                    </button>
                  </div>

                  <div className="access-footswitch">
                    No tienes cuenta?{' '}
                    <button onClick={handleMode(ACCESS_MODES.register)} type="button">
                      Crear una
                    </button>
                  </div>
                </form>
              </div>
            ) : activeMode === ACCESS_MODES.verify ? (
              <div className="access-pane active" id="pane-verify">
                <h2>Verifica tu correo</h2>
                <p className="access-sub">
                  Ingresa el codigo de 6 digitos para activar la cuenta y poder iniciar sesion.
                </p>

                <form onSubmit={handleVerifySubmit}>
                  <div className="access-field">
                    <label>Correo electronico</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">✉</span>
                      <input
                        autoComplete="email"
                        onChange={onVerifyField('email')}
                        placeholder="tu@correo.com"
                        type="email"
                        value={verifyEmailValue}
                      />
                    </div>
                  </div>

                  <div className="access-field">
                    <label>Codigo de verificacion</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">#</span>
                      <input
                        inputMode="numeric"
                        maxLength={6}
                        onChange={onVerifyField('code')}
                        placeholder="123456"
                        value={verifyForm.code}
                      />
                    </div>
                  </div>

                  <button className="access-submitbtn" disabled={isAuthBusy} type="submit">
                    {isAuthBusy ? 'Verificando...' : 'Verificar y entrar'}
                  </button>

                  <div className="access-rowbetween">
                    <button className="access-linklike" onClick={handleResendCode} type="button">
                      Reenviar codigo
                    </button>
                    <button className="access-linklike" onClick={handleMode(ACCESS_MODES.login)} type="button">
                      Volver al login
                    </button>
                  </div>
                </form>
              </div>
            ) : activeMode === ACCESS_MODES.mfa ? (
              <div className="access-pane active" id="pane-mfa">
                <h2>Verificacion MFA</h2>
                <p className="access-sub">
                  Ingresa el codigo de 6 digitos de tu app autenticadora
                  {mfaHint ? ` para ${mfaHint}` : ''}.
                </p>

                <form onSubmit={handleMfaSubmit}>
                  <div className="access-field">
                    <label>Codigo MFA</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">#</span>
                      <input
                        inputMode="numeric"
                        maxLength={6}
                        onChange={onMfaField('code')}
                        placeholder="123456"
                        value={mfaForm.code}
                      />
                    </div>
                  </div>

                  <button className="access-submitbtn" disabled={isAuthBusy} type="submit">
                    {isAuthBusy ? 'Verificando...' : 'Validar y entrar'}
                  </button>

                  <div className="access-rowbetween">
                    <button
                      className="access-linklike"
                      onClick={() => {
                        clearMfaLoginChallenge()
                        setMfaForm({ code: '' })
                        setMode(ACCESS_MODES.login)
                      }}
                      type="button"
                    >
                      Volver al login
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="access-pane active" id="pane-registro">
                <h2>Crea tu cuenta</h2>
                <p className="access-sub">
                  Unete y empieza a compartir lo que ves en tu comunidad.
                </p>

                <div className="access-anontip">
                  <span className="access-ic">🛡</span>
                  <div>
                    Puedes publicar denuncias de forma <b>anonima</b> mas adelante, incluso teniendo
                    una cuenta identificada. Tu identidad nunca se muestra en una denuncia anonima.
                  </div>
                </div>

                <form onSubmit={handleRegisterSubmit}>
                  <div className="access-field">
                    <label>Nombre de usuario</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">@</span>
                      <input
                        autoComplete="username"
                        onChange={onRegisterField('username')}
                        placeholder="tu_usuario"
                        value={registerForm.username}
                      />
                    </div>
                  </div>

                  <div className="access-field">
                    <label>Correo electronico</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">✉</span>
                      <input
                        autoComplete="email"
                        onChange={onRegisterField('email')}
                        placeholder="tu@correo.com"
                        type="email"
                        value={registerForm.email}
                      />
                    </div>
                  </div>

                  <div className="access-field">
                    <label>Nombre visible</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">☺</span>
                      <input
                        onChange={onRegisterField('displayName')}
                        placeholder="Como quieres aparecer"
                        value={registerForm.displayName}
                      />
                    </div>
                  </div>

                  <div className="access-field">
                    <label>Contrasena</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">🔒</span>
                      <input
                        autoComplete="new-password"
                        onChange={onRegisterField('password')}
                        placeholder="Minimo 8 caracteres"
                        type={showRegisterPassword ? 'text' : 'password'}
                        value={registerForm.password}
                      />
                      <button className="access-toggle" onClick={toggleRegisterPassword} type="button">
                        {showRegisterPassword ? 'OCULTAR' : 'MOSTRAR'}
                      </button>
                    </div>
                    <div className="access-strengthbar" aria-hidden="true">
                      <div className={passwordStrength >= 1 ? 'on1' : ''} />
                      <div className={passwordStrength >= 2 ? 'on2' : ''} />
                      <div className={passwordStrength >= 3 ? 'on3' : ''} />
                    </div>
                  </div>

                  <div className="access-field">
                    <label>Confirmar contrasena</label>
                    <div className="access-inputwrap">
                      <span className="access-ic">🔒</span>
                      <input
                        autoComplete="new-password"
                        onChange={onRegisterField('confirmPassword')}
                        placeholder="Repite la clave"
                        type={showRegisterConfirmPassword ? 'text' : 'password'}
                        value={registerForm.confirmPassword}
                      />
                      <button className="access-toggle" onClick={toggleRegisterConfirmPassword} type="button">
                        {showRegisterConfirmPassword ? 'OCULTAR' : 'MOSTRAR'}
                      </button>
                    </div>
                  </div>

                  <div className="access-rowbetween access-termsrow">
                    <label className="access-checkline">
                      <input
                        checked={termsAccepted}
                        onChange={(event) => setTermsAccepted(event.target.checked)}
                        type="checkbox"
                      />
                      Acepto los <span className="access-linklike">Terminos</span> y la{' '}
                      <span className="access-linklike">Privacidad</span>
                    </label>
                  </div>

                  <button className="access-submitbtn" disabled={isAuthBusy || !termsAccepted} type="submit">
                    {isAuthBusy ? 'Creando cuenta...' : 'Crear cuenta'}
                  </button>

                  <div className="access-divider">O CONTINUA CON</div>
                  <div className="access-oauth">
                    <button
                      disabled={isAuthBusy || Boolean(oauthProviderLoading)}
                      onClick={handleGoogleLogin}
                      type="button"
                    >
                      {oauthProviderLoading === 'google' ? 'Conectando Google...' : '🔵 Continuar con Google'}
                    </button>
                    <button
                      disabled={isAuthBusy || Boolean(oauthProviderLoading)}
                      onClick={handleAppleLogin}
                      type="button"
                    >
                      {oauthProviderLoading === 'apple' ? 'Conectando Apple...' : '🍎 Continuar con Apple'}
                    </button>
                  </div>

                  <div className="access-footswitch">
                    Ya tienes cuenta?{' '}
                    <button onClick={handleMode(ACCESS_MODES.login)} type="button">
                      Inicia sesion
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
