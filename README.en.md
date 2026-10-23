# NEXUS — Datacenter CEO Simulator

**Run an AI datacenter from the CEO's desk, then walk inside the infrastructure that makes compute possible.**

[Play in your browser](https://bjtu.echoxai.net/) · [Backup entry](http://120.26.147.100:8080/) · [阿里云部署](docs/ALIYUN.md) · [中文](README.md)

> Use the full **https://** URL. Plain `http://` is intercepted by the Aliyun ICP block page; this is a domain-filing restriction, not a game issue.

![CEO office](docs/images/01-ceo-office.png)

NEXUS is an open-source, first-person 3D management game for learning about AI infrastructure. Start with 256 GPUs, sign customers, procure equipment, expand your campus and manage cooling incidents. The current game interface is in Chinese.

- Explore the CEO office, construction site, campus and server hall.
- Inspect optical networking, power, storage, GPUs and liquid cooling.
- Track equipment lead times, contracts, customer invoices and operating cash flow.
- Balance all infrastructure constraints: installed GPUs alone are not deliverable compute.
- Register with your name and an eight-digit student ID; progress syncs to the teaching server and survives a browser reset.
- Teachers get a class dashboard with rankings, student search and CSV export.

## Controls

**F** stand/sit · **WASD** move · **drag / arrow keys** look · **E** inspect. The bottom toolbar opens management panels and changes locations. **Next day** settles the current operating day before advancing construction, deliveries and contract expiry.

Sign Orion AI first. Complete A2 construction, install at least 1,024 GPUs, serve at least 768 GPUs, maintain positive daily operating cash flow and keep cash above zero. Thirty days is a suggested target, not a hard limit.

## Classroom accounts

| Role | Credentials | Notes |
| --- | --- | --- |
| Student | Name + eight-digit ID + chosen password | Self-register, then play; progress syncs automatically |
| Teacher | `jiaowen` / `bjtu888` | Change the password after the first login |

The teacher dashboard shows the class ranking by best score, supports search and CSV export, and can reset an individual student's cloud save. Scores cover revenue, daily operating cash flow, ready GPU capacity, construction progress, cash safety, board objectives and completion speed.

## Run locally

```bash
npm ci
npm run dev
npm test
npm run build
npm start
```

Use Node.js 24 LTS (22.13+ works). `npm run dev` starts Vite on port 5173 and the teaching API on 8787. Accounts and scores live in SQLite via Node's built-in `node:sqlite`; there is no external database and no API key. See the [deployment guide](docs/DEPLOYMENT.md), [Aliyun deployment notes](docs/ALIYUN.md), [Chinese tutorial](docs/TUTORIAL.md), and [narrated visual tutorials](docs/videos/README.md).

All companies, customers, prices, timelines and operating parameters in the game are fictional teaching assumptions. Public Nebius and NVIDIA materials provide educational references. NEXUS is not an official Nebius product and is not a replica of a real Nebius campus.

Based on the teaching edition by [B-M-Capital-Research](https://github.com/B-M-Capital-Research/nexus-datacenter-ceo). MIT licensed. See [third-party notices](THIRD_PARTY_NOTICES.md).

[Watch the narrated Chinese video tutorials](docs/videos/README.md)
