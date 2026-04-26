import { createClient } from '@supabase/supabase-js';
import './styles.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import ShiftPlanner from './pages/ShiftPlanner.jsx';
import './pages/ShiftPlanner.css';

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
    appLink: '/shift-planner'
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

if (window.location.pathname === '/shift-planner') {
  renderShiftPlannerRoute();
} else {
  init();
}

let state = {
  user: null,
  loading: true,
  mode: 'signin',
  message: '',
  subscriptions: {},
  checkingSubscriptions: false
};

function html(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '');
}

function productToSubscriptionKey(productId) {
  if (productId === 'shift-planner') return 'shift_planner';
  if (productId === 'pricing-assistant') return 'pricing_assistant';
  if (productId === 'spa-cost-estimator') return 'spa_cost_estimator';
  return productId.replaceAll('-', '_');
}

function isSubscribed(productId) {
  return Boolean(state.subscriptions[productToSubscriptionKey(productId)]);
}

async function loadSubscriptions() {
  if (!hasSupabaseConfig || !supabase || !state.user) {
    state.subscriptions = {};
    return;
  }

  state.checkingSubscriptions = true;

  const { data, error } = await supabase
    .from('subscriptions')
    .select('product, status, current_period_end')
    .eq('user_id', state.user.id)
    .in('status', ['active', 'trialing', 'paid']);

  if (error) {
    console.error(error);
    state.message = 'Could not check subscriptions. Make sure your subscriptions table and RLS policies are set up.';
    state.subscriptions = {};
    state.checkingSubscriptions = false;
    return;
  }

  const activeMap = {};

  (data || []).forEach((row) => {
    const notExpired =
      !row.current_period_end ||
      new Date(row.current_period_end).getTime() > Date.now();

    if (notExpired) {
      activeMap[row.product] = true;
    }
  });

  state.subscriptions = activeMap;
  state.checkingSubscriptions = false;
}

function buildStripeUrl(product) {
  const url = new URL(product.stripeLink);

  if (state.user?.email) {
    url.searchParams.set('prefilled_email', state.user.email);
  }

  if (state.user?.id) {
    url.searchParams.set('client_reference_id', state.user.id);
  }

  return url.toString();
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
          This portal controls access to Faraj Software Solutions web apps.
          Users can create an account, subscribe, and access paid tools from one dashboard.
        </p>

        <div class="mini-grid">
          <div><strong>3</strong><span>Software tools</span></div>
          <div><strong>Supabase</strong><span>Auth ready</span></div>
          <div><strong>Stripe</strong><span>Subscription access</span></div>
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
            Choose a subscription below. Successful payment unlocks the matching software when Stripe updates your Supabase subscription record.
          </p>
          ${state.message ? `<p class="portal-message">${state.message}</p>` : ''}
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
        <h2>Subscription access</h2>
        <p>
          Shift Planner access is now checked against Supabase. A user must have an active
          <strong> shift_planner </strong> subscription row before opening the app.
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
        <a class="btn primary" href="${buildStripeUrl(product)}" target="_blank" rel="noopener">
          Subscribe with Stripe
          <span class="btn-sub">secure checkout</span>
        </a>

        ${
          active
            ? `<a class="btn secondary" href="${product.appLink}">Open App</a>`
            : `<button class="btn locked" type="button" data-locked-product="${product.id}">
                Locked until paid
              </button>`
        }
      </div>
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

  document.querySelectorAll('[data-locked-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const product = products.find((item) => item.id === btn.dataset.lockedProduct);
      state.message = `${product?.name || 'This app'} is locked until your subscription is active. If you already paid, refresh the page in a moment.`;
      render();
    });
  });
}

async function submitAuth(event) {
  event.preventDefault();

  const email = document.querySelector('#email').value.trim();
  const password = document.querySelector('#password').value;

  state.message = '';

  if (!hasSupabaseConfig) {
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

  await loadSubscriptions();
  render();
}

async function signOut() {
  if (hasSupabaseConfig) {
    await supabase.auth.signOut();
  }

  state.user = null;
  state.subscriptions = {};
  state.message = '';
  render();
}

async function init() {
  if (hasSupabaseConfig) {
    const { data } = await supabase.auth.getSession();
    state.user = data.session?.user || null;

    if (state.user) {
      await loadSubscriptions();
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      state.user = session?.user || null;

      if (state.user) {
        await loadSubscriptions();
      } else {
        state.subscriptions = {};
      }

      state.loading = false;
      render();
    });
  }

  state.loading = false;
  render();
}

async function renderShiftPlannerRoute() {
  if (!hasSupabaseConfig || !supabase) {
    app.innerHTML = `<main class="portal-shell"><section class="auth-card"><p>Supabase is not configured.</p></section></main>`;
    return;
  }

  const { data } = await supabase.auth.getSession();
  const user = data.session?.user || null;

  if (!user) {
    window.location.href = '/';
    return;
  }

  const { data: sub, error } = await supabase
    .from('subscriptions')
    .select('product, status, current_period_end')
    .eq('user_id', user.id)
    .eq('product', 'shift_planner')
    .in('status', ['active', 'trialing', 'paid'])
    .limit(1)
    .maybeSingle();

  if (error) {
    app.innerHTML = `<main class="portal-shell"><section class="auth-card"><p>${error.message}</p></section></main>`;
    return;
  }

  const notExpired =
    !sub?.current_period_end ||
    new Date(sub.current_period_end).getTime() > Date.now();

  if (!sub || !notExpired) {
    window.location.href = '/';
    return;
  }

  createRoot(app).render(React.createElement(ShiftPlanner, { user, supabase }));
}