# Deploying

One container per client app, plus a Postgres each app has its own database in.

## Build

`@ziku/ui` is a private git dependency, so the image build needs SSH:

```bash
docker build --ssh default -t acme-portal .
docker compose build --ssh default
```

On Coolify or Dokploy: add a deploy key for `ziku-io/design-system` and enable
SSH forwarding for the build. Making the design system public, or publishing it
to GitHub Packages, removes this step for good.

## Environment

| Key                  | Notes                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`       | One database per app. `pnpm setup` names it after the app.              |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. Changing it signs everyone out.              |
| `APP_URL`            | The public origin. Must match, or the CSRF origin check refuses writes. |
| `PORT`               | Defaults to 3000.                                                       |

Modules add their own; `pnpm setup` writes them into `.env` with defaults and a
comment each.

## Database

One Postgres serves many client apps — a database per app, not a schema per app,
so a dump is one client's data and nothing else. Migrations run on boot, so a
deploy is: build, swap the container, done.

Back up with `pg_dump` per database. Test the restore before you need it.

## Uploads

The `files` module writes to `UPLOAD_DIR` on the container's disk. Mount a volume
there, or the next deploy loses them. Running more than one instance means moving
to shared storage: the three functions in `src/modules/files/storage.ts` are the
whole surface to swap.

## First admin

Everyone signs up as `member`. Promote the first one by hand:

```sql
UPDATE "user" SET role = 'admin' WHERE email = 'you@client.com';
```

After that the `users` module handles it.

## Checks after a deploy

```bash
./smoke.sh https://app.client.com
```

It registers a throwaway account, exercises every installed module and signs out.
Safe against production, though it does leave the account behind — delete it, or
point it at staging.
