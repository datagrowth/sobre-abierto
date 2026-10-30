# Sobre Abierto

[![License: AGPL-3.0](https://img.shields.io/github/license/datagrowth/sobre-abierto)](LICENSE)
[![Version](https://img.shields.io/github/v/release/datagrowth/sobre-abierto?include_prereleases)](https://github.com/datagrowth/sobre-abierto/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/datagrowth/sobre-abierto/ci.yml?branch=main&label=CI)](https://github.com/datagrowth/sobre-abierto/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/orgs/datagrowth/packages?repo_name=sobre-abierto)

**Open-source platform for winning public tenders.** It watches the Spanish Public Sector Procurement Platform
(PLACSP), uses AI to screen what fits your company, and helps you prepare the bid: tender sheet, team, price,
technical proposal and annexes. It runs on your server, with your data and your AI provider.

[Español](README.md) · [Documentation (Spanish)](https://docs.sobreabierto.datagrowth.es) · [Installation (Spanish)](docs/empezar/instalacion.md) · [User guide (Spanish)](docs/guia/README.md) · [Architecture (Spanish)](docs/como-esta-hecho/arquitectura.md)

> The interface, the AI-generated text and the documentation are in **Spanish**, and the product is designed for
> Spanish public procurement (PLACSP, CPV codes, DEUC, Spanish company registries). This page is a translation of the
> Spanish [README](README.md), which is the reference.

- **Radar.** Pulls PLACSP every 15 minutes, filters by CPV, amount and region, and puts what may fit in *Oportunidades*.
- **AI screening and tender sheets.** [Hermes Agent](https://github.com/NousResearch/hermes-agent) compares each tender
  with your company profile and writes a sheet with requirements, award criteria and risks, citing the page of the
  tender documents that supports each one.
- **Bid.** Outline, technical proposal written in phases (dossier, strategy, drafting, independent critic),
  annexes, DEUC, and checks that tell you what is missing before you submit.
- **Market and learning.** Competitors, contracting bodies, previous award prices and lessons from each bid.
- **Knowledge Library.** Your notes and documents, on disk or synced with Google Drive.
- **Team.** Users with roles, email alerts and a deadlines calendar.

## How it works, in a minute

Code downloads and normalizes PLACSP, computes deadlines, amounts and past awards, and checks that a bid is complete.
The AI reads the tender documents, drafts and critiques, but **only proposes**: a person decides. All AI runs in
Hermes, so the platform holds no model keys and you can switch providers without touching the code. The design, with
diagrams, is in [docs/como-esta-hecho/arquitectura.md](docs/como-esta-hecho/arquitectura.md) (Spanish).

## Status

**Beta.** Real teams use it, but there are rough edges: back up before upgrading and read the
[CHANGELOG](CHANGELOG.md).

## Quick install

You need a Linux server with Docker 24+ and Compose v2 (at least 6 GB of memory) and an account with an AI provider.
Download the script, read it, run it:

```bash
curl -fsSLO https://raw.githubusercontent.com/datagrowth/sobre-abierto/main/install.sh
less install.sh
bash install.sh
```

It asks for the admin email, the domain (optional) and the AI provider; generates the keys, starts everything, creates
the Hermes profiles and, at the end, prints the address and an initial password (the web asks you to change it on
first login and it stops working afterwards; see [first access](docs/empezar/instalacion.md#primer-acceso) and, if you lose
access, [how to recover it](docs/operar/usuarios-y-acceso.md)). The first screen walks you through
the *first steps*: your company profile, which tenders to look for, and the AI. Run it again at any time: it never
changes a value already in `.env`. `bash install.sh --ayuda` lists every option.

Requirements, manual installation with Compose or with a panel (Dokploy, Coolify, Easypanel), and how to pick the
model for each profile are in [docs/empezar/instalacion.md](docs/empezar/instalacion.md) (Spanish).

## Privacy

**There is no telemetry.** Sobre Abierto sends usage data to no one. The only outbound connections are the ones you
configure: public sources (PLACSP), your AI provider, your SMTP server and, if you enable it, Google Drive. People's CV
data only reaches Hermes in the bid profile, never the other agents.

## Documentation

All of it is in Spanish, in [docs/](docs/README.md) (one folder per section) and published at
[docs.sobreabierto.datagrowth.es](https://docs.sobreabierto.datagrowth.es).

| | |
|---|---|
| [Empezar](docs/empezar/README.md) | Getting started: what it is, installation, first steps, settings and upgrades |
| [Guía de uso](docs/guia/README.md) | User guide, screen by screen: radar, opportunities, pipeline, bid file, market… |
| [Operar](docs/operar/README.md) | Running an installation: backups, restarts, users, Drive, email and security |
| [Referencia](docs/referencia/README.md) | Reference: environment variables, MCP tools, roles and permissions, FAQ |
| [Cómo está hecho](docs/como-esta-hecho/README.md) | How it is built: architecture, technical proposal and bid folders |
| [Contribuir](docs/contribuir/README.md) | Contributing: development, [CONTRIBUTING.md](.github/CONTRIBUTING.md) and [SECURITY.md](.github/SECURITY.md) |

## License

[AGPL-3.0-or-later](LICENSE): you may use, modify and deploy it, including inside your company. If you offer a
modified version to other people over a network, you must give them its source code (the link is in the app footer).
Third-party components are listed in [NOTICE.md](NOTICE.md); use of the name and logo is covered in
[TRADEMARKS.md](TRADEMARKS.md).
