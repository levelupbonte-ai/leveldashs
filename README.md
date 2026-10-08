<h1 align="center">LevelUp Dashboard</h1>

<div align="center">Client dashboard for the LevelUp Ecosystem platform.</div>

## Overview

LevelUp Dashboard is the admin/client dashboard used by LevelUp organizations to manage their website content, customers and settings. It talks directly to the shared LevelUp Ecosystem Supabase project: users sign in with Supabase Auth and every query runs as the signed-in user, so authorization and tenant isolation (`organization_id` / `website_id`) are enforced by Row Level Security in the database. The UI is in French.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query/Table/Form, Zod, nuqs and Supabase (Auth, Postgres, Storage).

See [AGENTS.md](./AGENTS.md) for conventions and [docs/](./docs) for forms, themes, RBAC, auth and deployment.

## Folder Structure

```plaintext
src/
├── app/                           # Next.js App Router directory
│   ├── auth/                      # Auth pages (sign-in, sign-up, callback)
│   ├── dashboard/                 # Dashboard route group
│   │   ├── site/                  # Client website management (content, inbox, media, settings)
│   │   ├── overview/              # Analytics with parallel routes
│   │   ├── product/               # Product CRUD pages (React Query)
│   │   ├── users/                 # Users table (React Query + nuqs)
│   │   ├── react-query/           # React Query demo page
│   │   ├── kanban/                # Task board page
│   │   ├── chat/                  # Messaging page
│   │   ├── ai-chat/               # AI chat streaming demo
│   │   ├── notifications/         # Notifications page
│   │   ├── workspaces/            # Organizations & team members
│   │   ├── billing/               # Static "billing handled by LevelUp" page
│   │   ├── profile/               # User profile & password
│   │   └── exclusive/             # LevelUp admin: all clients (platform admins only)
│   └── api/                       # API routes
│
├── components/                    # Shared components
│   ├── ui/                        # UI primitives (buttons, inputs, dialogs, etc.)
│   ├── layout/                    # Layout components (header, sidebar, etc.)
│   ├── themes/                    # Theme system (selector, mode toggle, config)
│   └── kbar/                      # Command+K interface
│
├── features/                      # Feature-based modules
│   ├── site/                      # Website content, inbox, media, settings (Supabase)
│   ├── organizations/             # Organizations, members, LevelUp admin
│   ├── overview/                  # Dashboard analytics (charts, cards)
│   ├── products/                  # Product listing, form, tables (React Query)
│   ├── users/                     # User management table (React Query)
│   ├── react-query-demo/          # React Query demo (Pokemon API)
│   ├── kanban/                    # Drag-drop task board
│   ├── chat/                      # Messaging (conversations, bubbles, composer)
│   ├── ai-chat/                   # Scripted useChat streaming demo (shadcn chat UI)
│   ├── notifications/             # Notification center & store
│   ├── auth/                      # Auth components
│   └── profile/                   # Profile form schemas
│
├── lib/                           # Core utilities (query-client, searchparams, etc.)
│   ├── supabase/                  # Browser, server and proxy Supabase clients
│   └── auth/                      # Dashboard session, active org/website, roles
├── hooks/                         # Custom hooks
├── config/                        # Navigation, infobar, data table config
├── constants/                     # Mock data
├── styles/                        # Global CSS & theme files
│   └── themes/                    # Individual theme CSS files
└── types/                         # TypeScript types
```

## Getting Started

- `bun install`
- Copy the example env file: `cp env.example.txt .env.local`
- Fill in the required variables in `.env.local` (never put secrets in `NEXT_PUBLIC_*` variables)
- `bun run dev`

The app runs at http://localhost:3000. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the only Supabase key the app uses). For auth setup (redirect URLs, Google provider, organizations and roles) see [docs/auth.md](./docs/auth.md); for the schema see [docs/database.md](./docs/database.md).

## Cleanup Script

A cleanup script that removes the optional features you don't need (folders, files, dependencies, docs, and env entries), leaving a minimal base to build on. Run `--list` to see what's removable:

```bash
bun run cleanup --interactive    # interactive mode
bun run cleanup --list           # see available features
bun run cleanup --dry-run chat   # preview before removing
bun run cleanup kanban chat      # remove specific features
```

Run `bun run cleanup --help` for all options (with npm, pass flags after `--`: `npm run cleanup -- --list`). The replacement files it writes live in `scripts/cleanup-templates/` as real, typechecked code. When you're done, delete `scripts/cleanup.js`, `scripts/cleanup-templates/`, and the `cleanup` entry in `package.json`.

## Deploy

Vercel or Docker (Node.js and Bun Dockerfiles, Next.js standalone output). See [docs/deployment.md](./docs/deployment.md).

## License

Proprietary © LevelUp Ecosystem. Portions derived from an MIT-licensed open source project; see [LICENSE](./LICENSE).
