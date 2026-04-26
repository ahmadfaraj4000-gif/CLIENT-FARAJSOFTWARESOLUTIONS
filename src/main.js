import { createClient } from '@supabase/supabase-js';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const hasSupabaseConfig =
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('YOUR-PROJECT') &&
  !supabaseAnonKey.includes('YOUR_SUPABASE');

const supabase = hasSupabaseConfig ? createClient(supabaseUrl, supabaseAnonKey) : null;

const products = [
  {
    id: 'pricing-assistant',
    name: 'Pricing Assistant',
    eyebrow: 'Restaurant pricing',
    description:
      'Price menu items using food cost, labor, overhead, waste, packaging, and profit targets.',
    price: '$29/mo',
    stripeLink:
      import.meta.env.VITE_STRIPE_PRICING_ASSISTANT_LINK ||
      'https://buy.stripe.com/placeholder-pricing-assistant',
    appLink: '/pricing-assistant-app.html'
  },
  {
    id: 'shift-planner',
    name: 'Shift Planner',
    eyebrow: 'Labor scheduling',
    description:
      'Build weekly schedules, estimate labor cost, compare against revenue, and spot over-budget days.',
    price: '$29/mo',
    stripeLink:
      import.meta.env.VITE_STRIPE_SHIFT_PLANNER_LINK ||
      'https://buy.stripe.com/3cIdRb6MO8Jm3cTbWn5Ne0b',
    appLink: '/shift-planner-demo.html'
  },
  {
    id: 'spa-cost-estimator',
    name: 'Spa Cost Estimator',
    eyebrow: 'Service business costs',
    description:
      'Estimate cost per client by factoring products, rent, supplies, equipment, time, and operating expenses.',
    price: '$19/mo',
    stripeLink:
      import.meta.env.VITE_STRIPE_SPA_CALCULATOR_LINK ||
      'https://buy.stripe.com/placeholder-spa-calculator',
    appLink: '/spa-calculator-demo.html'
  }
];

const app = document.querySelector('#app');

let state = {
  user: null,
  loading: true,
  mode: 'signin',
  message: ''
};

function isSubscribed(productId) {
  // Temporary front-end placeholder.
  // Later this should come from Supabase after Stripe webhook updates the user's subscription row.
  return localStorage.getItem(`subscribed:${productId}`) === 'true';
}

function setSubscribed(productId, value) {
  localStorage.setItem(`subscribed:${productId}`, value ? 'true' : 'false');
  render();
}

function html(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '');
}

function render() {
  if (state.loading) {
    app.innerHTML = `
      <main class="portal-shell">
        <section class="auth-card">
          <div class="loading-dot"></div>
          <p>Loading client portal...</p>
        </section>
      </main>
    `;
    return;
  }

  app.innerHTML = `
    <div class="bg">
      <header class="portal-header">
        <a class="portal-brand" href="https://farajsoftwaresolutions.com">
          <div class="mark" aria-hidden="true">
            <span class="mark-bar b1"></span>
            <span class="mark-bar b2"></span>
            <span class="mark-bar b3"></span>
          </div>
          <div>
            <div class="brand-title">Faraj Software Solutions</div>
            <div class="brand-sub">Client Software Portal</div>
          </div>
        </a>

        ${
          state.user
            ? `<button class="nav-btn" id="logoutBtn" type="button">Log out</button>`
            : `<a class="nav-btn" href="https://farajsoftwaresolutions.com">Back to site</a>`
        }
      </header>

      ${state.user ? portalView() : authView()}
    </div>
  `;

  bindEvents();
}

function authView() {
  const isSignup = state.mode === 'signup';

  return `
    <main class="portal-shell auth-layout">
      <section class="auth-copy">
        <div class="demo-eyebrow">Secure client access</div>
        <h1>Log in to manage your business software.</h1>
        <p>
          This portal will control access to Faraj Software Solutions web apps.
          For now, users can create an account and see subscription placeholders before accessing each tool.
        </p>

        <div class="mini-grid">
          <div><strong>3</strong><span>Software tools</span></div>
          <div><strong>Supabase</strong><span>Auth ready</span></div>
          <div><strong>Stripe</strong><span>Subscriptions next</span></div>
        </div>
      </section>

      <section class="auth-card">
        <div class="auth-tabs">
          <button class="${!isSignup ? 'active' : ''}" data-mode="signin">Sign in</button>
          <button class="${isSignup ? 'active' : ''}" data-mode="signup">Create account</button>
        </div>

        <h2>${isSignup ? 'Create your account' : 'Welcome back'}</h2>
        <p class="auth-muted">
          ${isSignup ? 'Use your email and password to create portal access.' : 'Sign in to view your software subscriptions.'}
        </p>

        ${!hasSupabaseConfig ? `
          <div class="setup-warning">
            Add your Supabase URL and anon key in <code>.env</code> before using real login.
          </div>
        ` : ''}

        <form id="authForm" class="auth-form">
          <label>
            Email
            <input id="email" type="email" autocomplete="email" placeholder="you@example.com" required />
          </label>

          <label>
            Password
            <input id="password" type="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" placeholder="••••••••" required />
          </label>

          <button class="btn primary" type="submit">
            ${isSignup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        ${state.message ? `<p class="portal-message">${state.message}</p>` : ''}
      </section>
    </main>
  `;
}

function portalView() {
  return `
    <main class="portal-shell">
      <section class="portal-hero">
        <div>
          <div class="demo-eyebrow">Client Portal</div>
          <h1>Your software dashboard</h1>
          <p>
            Choose a subscription below. Once Stripe is connected, successful payment will unlock the matching software automatically.
          </p>
        </div>
        <div class="user-pill">
          <span>Signed in as</span>
          <strong>${state.user.email}</strong>
        </div>
      </section>

      <section class="software-grid">
        ${products.map(productCard).join('')}
      </section>

      <section class="next-box">
        <h2>Next backend step</h2>
        <p>
          After this front end is live, connect Stripe webhooks to Supabase so paid users get marked active in a subscriptions table.
        </p>
      </section>
    </main>
  `;
}

function productCard(product) {
  const active = isSubscribed(product.id);

  return `
    <article class="software-card">
      <div class="product-top">
        <span class="product-badge">${product.eyebrow}</span>
        <span class="product-version">${product.price}</span>
      </div>

      <h2>${product.name}</h2>
      <p>${product.description}</p>

      <div class="card-actions">
        <a class="btn primary" href="${product.stripeLink}" target="_blank" rel="noopener">
          Subscribe with Stripe
          <span class="btn-sub">placeholder link</span>
        </a>

        ${
          active
            ? `<a class="btn secondary" href="${product.appLink}">Open App</a>`
            : `<button class="btn locked" type="button" disabled>Locked until paid</button>`
        }
      </div>

      <button class="dev-unlock" data-product="${product.id}" data-active="${active ? 'true' : 'false'}" type="button">
        ${active ? 'Dev: mark unpaid' : 'Dev: mark paid'}
      </button>
    </article>
  `;
}

function bindEvents() {
  document.querySelector('#logoutBtn')?.addEventListener('click', signOut);

  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      state.message = '';
      render();
    });
  });

  document.querySelector('#authForm')?.addEventListener('submit', submitAuth);

  document.querySelectorAll('.dev-unlock').forEach((btn) => {
    btn.addEventListener('click', () => {
      const productId = btn.dataset.product;
      const active = btn.dataset.active === 'true';
      setSubscribed(productId, !active);
    });
  });
}

async function submitAuth(event) {
  event.preventDefault();

  const email = document.querySelector('#email').value.trim();
  const password = document.querySelector('#password').value;

  state.message = '';

  if (!hasSupabaseConfig) {
    // Local preview fallback so you can test the portal layout before Supabase is connected.
    state.user = { email };
    render();
    return;
  }

  const response =
    state.mode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

  if (response.error) {
    state.message = response.error.message;
    render();
    return;
  }

  state.user = response.data.user || response.data.session?.user || { email };
  state.message = state.mode === 'signup'
    ? 'Account created. Check your email if confirmation is enabled.'
    : '';

  render();
}

async function signOut() {
  if (hasSupabaseConfig) {
    await supabase.auth.signOut();
  }

  state.user = null;
  state.message = '';
  render();
}

async function init() {
  if (hasSupabaseConfig) {
    const { data } = await supabase.auth.getSession();
    state.user = data.session?.user || null;

    supabase.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user || null;
      state.loading = false;
      render();
    });
  }

  state.loading = false;
  render();
}

init();
