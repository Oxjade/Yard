# Auth0 social login

Yard can use one Auth0 application as an all-in-one social login: Google, Facebook, Apple, X,
Microsoft, LinkedIn, GitHub, … each shown as its own **Continue with …** button. Auth0 is wired
as a generic OpenID Connect provider (`auth0`) next to the direct Google and Apple providers:
authorization code + PKCE + state + nonce, ID token verified against the tenant's JWKS.

Accounts link exactly like direct Google: a new Auth0 identity whose **verified** email matches a
Yard account with a verified email signs in to that account, so Google-direct and Google-via-Auth0
land on the same Yard account. Sign-ins whose email is unverified (or missing `email_verified`)
are refused with "That account's email address isn't verified with the provider".

## 1. Auth0 dashboard

**Applications → Applications → Create Application → Regular Web Application.** On its
**Settings** tab (replace `yard.example.com` with your `YARD_PUBLIC_URL` host):

| Setting | Value |
|---|---|
| Allowed Callback URLs | `https://yard.example.com/api/auth/oauth/auth0/callback` |
| Allowed Logout URLs | `https://yard.example.com/` |
| Allowed Web Origins | `https://yard.example.com` |
| Application Login URI | leave empty |

Under **Advanced Settings → Grant Types** keep **Authorization Code** enabled (the default).
Under **Advanced Settings → OAuth**, **JSON Web Token Signature Algorithm** must be **RS256**
(the default). Copy **Domain**, **Client ID** and **Client Secret** into the env below.

For a staging server add its callback/logout/origin too (comma-separated in each field).

## 2. Connections

**Authentication → Social**: create the connections you want (Google / Gmail is there by
default as `google-oauth2`). For each one, open it and on its **Applications** tab enable your
Yard application. Use your own developer keys for each social provider in production (Auth0's
dev keys only work for testing and show an Auth0 consent screen).

Turn off **Authentication → Database → Username-Password-Authentication** for this application
if you only want social buttons (Yard has its own email and password sign-in).

Make sure each connection returns an email: Facebook needs the `email` permission, X needs
"Request email from users" enabled in the X developer app. Accounts without a verified email are
refused.

| Connection name (`AUTH0_CONNECTIONS`) | Button |
|---|---|
| `google-oauth2` | Continue with Google |
| `facebook` | Continue with Facebook |
| `apple` | Continue with Apple |
| `twitter` | Continue with X |
| `windowslive` | Continue with Microsoft |
| `linkedin` | Continue with LinkedIn |
| `github` | Continue with GitHub |
| anything else | the name, capitalised |

## 3. Env (`/etc/yard.env` or `.env.local`)

```
AUTH0_DOMAIN=dev-6jwzxkq64prgvqkh.us.auth0.com
AUTH0_CLIENT_ID=<Client ID from the application's Settings tab>
AUTH0_CLIENT_SECRET=<Client Secret from the application's Settings tab>
AUTH0_CONNECTIONS=google-oauth2
```

- `AUTH0_DOMAIN`: the tenant domain only, no `https://` and no path (a pasted `https://…/` is
  tolerated). With a custom domain, use it here.
- `AUTH0_CONNECTIONS`: comma-separated connection names, in button order. Default
  `google-oauth2`.
- If any of the first three is missing or invalid, Auth0 is off, the buttons are hidden and the
  server logs one line saying why (`[yard] Auth0 sign-in is off: …`).
- `AUTH0_ISSUER_BASE` is for tests only (a local mock such as `http://127.0.0.1:3291`); in
  production it must be `https://`, so leave it unset.

Restart Yard after changing env. Check with `curl https://yard.example.com/api/auth/providers`:
it should show `"auth0":true` and the `auth0Connections` list.

## 4. Switching connections

1. Enable the connection in Auth0 (step 2) for the Yard application.
2. Edit `AUTH0_CONNECTIONS`, e.g. `AUTH0_CONNECTIONS=google-oauth2,facebook,apple`.
3. Restart Yard.

Removing a connection from the list only hides its button; people who signed in with it keep
their Yard account and can still sign in with email (magic link / password reset) or another
button with the same verified email.

If direct Google keys (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) are also set, only one Google
button is shown and it uses the direct provider; the same goes for Apple (`APPLE_*`).

## 5. How it fits Yard

- Routes: `POST /api/auth/oauth/auth0/start { mode, actor, connection }` → `{ url }`;
  `GET /api/auth/oauth/auth0/callback` → `/auth/complete?provider=auth0&result=…`.
- Identity key: the ID token `sub` (e.g. `google-oauth2|1234…`), stored as provider `auth0`.
  A user may hold one Auth0 identity per connection.
- Studio money actions on an account without a password ask to confirm with the same social
  login (`reauthWith` = `auth0:<connection>`).
- Local end-to-end check (mock Auth0, nothing leaves the machine): `node scripts/auth0-e2e.mjs`;
  the header of that file lists the env the dev server needs.
