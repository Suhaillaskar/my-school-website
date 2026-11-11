# My School website

The site includes separate Home, About Us, Academics, Admission, Gallery, Notice Board, Results, and Contact Us pages, plus protected admin and student portals. Classes run from Class 1 to Class 12. The admin portal can create student accounts and publish or remove school notices and anonymous, class-level results. The public Results page never displays student names, individual marks, or email addresses. Student accounts can read notices and change their password.

## Run locally (Windows)

1. Install Node.js 22 or later.
2. From this folder, install dependencies:

   ```powershell
   npm install
   ```

3. Create the first administrator account. Enter its email and password when prompted (the password is hidden while you type):

   ```powershell
   npm run create-admin
   ```

   Passwords must be at least 12 characters. Admin credentials are not included in the source code.

4. Start the website:

   ```powershell
   npm start
   ```

5. Open [http://127.0.0.1:8080](http://127.0.0.1:8080). Sign in through **Admin Login**, then create student accounts and publish notices. Give each student their initial password privately.

Administrators can publish public exam summaries for Classes 1–12. Only the class, exam, academic year, and aggregate numbers of students who appeared or passed are published. Individual student grades, identifying information, and free-text notes are not accepted.

The SQLite database is stored in the `data` folder. Set `SCHOOL_DATA_DIR` to a persistent, private directory to store it elsewhere. Contact information and admission dates were not supplied, so those pages direct families to the school office rather than displaying invented details.

The site also includes local illustrative stock photos from [Unsplash](https://unsplash.com/license), so they load without external image requests. They are examples, not photos of My School. Replace them with images you own or have permission to publish before presenting the gallery as actual school life.

## Deploy publicly with Render

The included `render.yaml` configures a Node.js web service with HTTPS, a generated session secret, a `/health` check, and a persistent disk for the SQLite database. The web service and persistent disk require a paid Render plan. The database is created empty on first deploy; the local `data/` folder and its admin account are intentionally excluded from source control.

1. Push this project to a GitHub repository. A private repository is recommended; the deployed website can still be public.
2. In Render, choose **New → Blueprint**, connect the repository, and deploy using `render.yaml`.
3. After the first deploy, open the service's **Shell** and run `npm run create-admin`. Enter a new admin email and a strong, unique password when prompted. Do not reuse the password previously shared in chat.
4. Open the public `https://...onrender.com` address shown on the service page. Sign in as the newly created administrator, then add student accounts and publish notices or class-level results.

Keep the persistent disk attached to the service, and back up the database securely. Do not commit the `data/` directory, database files, passwords, or deployment secrets. This single-instance SQLite setup should not be scaled to multiple service instances.

## Production setup

- Set `NODE_ENV=production`.
- Set `SESSION_SECRET` to a private random value of at least 32 characters. To generate one locally with Node.js:

  ```powershell
  node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
  ```

- Set `HOST=0.0.0.0` and `PORT` as required by the hosting service. Serve the app behind HTTPS and use a persistent private `SCHOOL_DATA_DIR`; back up that directory securely.
- If TLS terminates at a trusted reverse proxy, set `TRUST_PROXY=1` only when that proxy overwrites forwarded headers and direct access to the app server is restricted. Do not enable it when clients can connect directly.

The server uses HTTPS-only session cookies in production, 12-hour server-side sessions, role-checked routes, password hashing with scrypt, same-site cookies and origin checks for writes, and a per-process sign-in attempt limit. The development session secret is temporary, so restarting the server signs users out. Use an external rate limiter if deploying multiple server instances.
