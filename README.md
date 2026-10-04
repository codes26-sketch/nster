# Answer Room

A private, password-protected Q&A library with code snippets, visitor search, light/dark themes, and two owner roles. It is a static frontend backed by one Netlify Function and Netlify Blobs for persistent data.

## Owner roles

- **Main owner**: add Q&A and change the visitor password.
- **Content owner**: add Q&A only.
- **Visitor**: browse, search, expand answers, and copy code examples.

The two owner passwords are set separately in Netlify. The visitor password can be changed from the main-owner panel. Changing it closes existing visitor sessions. The theme preference is saved in each visitor's browser.

## Deploy to Netlify

1. Push this folder to a Git repository and import that repository in Netlify.
2. The included `netlify.toml` publishes `public/` and deploys `netlify/functions/`; there is no build command.
3. In **Project configuration → Environment variables**, add these runtime variables:

   | Variable | Purpose |
   | --- | --- |
   | `VISITOR_PASSWORD` | Initial visitor password. Netlify Blobs stores a salted password hash after the first login. |
   | `MAIN_OWNER_PASSWORD` | Main-owner login password. |
   | `CONTENT_OWNER_PASSWORD` | Content-owner login password. |
   | `SESSION_SECRET` | At least 32 random characters used to sign sessions. |

4. Trigger a new deploy after setting the variables. The Netlify Blobs store is created on first use and keeps Q&A and the visitor-password setting across deploys.

You can import the local `.env` file instead of entering each value separately: choose **Import an .env file** in Netlify's Project configuration → Environment variables, or run `netlify env:import .env` from a linked project with the Netlify CLI. Netlify does not automatically read a checked-in `.env` file during builds; keep `.env` private and out of Git.

Keep these values private and use different passwords for each role. `SESSION_SECRET` can be generated with a password manager or a cryptographically secure random generator. Visitor passwords must be at least 5 characters.

## Run locally

Install Node.js 18 or newer and the Netlify CLI, then run:

```sh
npm install
npm install --global netlify-cli
npm run dev
```

Set the four variables in the shell or in a local `.env` file before starting Netlify Dev. Do not commit `.env`. Netlify Dev runs the frontend and function together at `http://localhost:8888`.

## Notes

- Netlify Blobs is a small key-value persistence layer; no external database account is required.
- Q&A is append-only from the web interface. Neither owner role can edit or delete a saved entry.
- Password changes affect visitor sessions immediately; owner sessions remain signed in.
