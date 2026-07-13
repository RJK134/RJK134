# CLAUDE.md — RJK134 Profile / FHE Digital Twin

> Karpathy-style AI context file. Keep at repo root. Updated: 2026-07-13.
> Owner: Richard Knapp · Future Horizons Education (FHE)

---

## 1. Who This Is

Richard Knapp — founder of **Future Horizons Education (FHE)**. Building a structurally-real UK HE Digital Twin across 5 tools with a single canonical Neon Postgres database.

### Five-Tool Ecosystem
| Tool | Role |
|------|------|
| **SJMS-5** | Student Records System — hosts the twin; primary governed write surface |
| **DATABRIDGE** | Migration + data-cleaning + HESA; inject→detect→clear defect loop |
| **HE-ERP** | Finance / HR / Estates / Procurement |
| **Curriculum Management** | Reads proposals; writes via `/v1/curriculum/proposals/:id/external-sync` |
| **HERM** | Maps capabilities onto Higher Education Reference Model |

---

## 2. Current Build State (Phase N — 2026-07-13)

- **Models**: 298 · **Routers**: 191 · **Workflows**: 80
- **API endpoints**: 550+ · **Frontend pages**: 81
- **Students seeded**: 40,272 (realistic UK HE data)
- **Tables**: 148 / 246 populated (98 empty — triage next)
- **Enrichment waves done**: 12

### Domain Completion
| Domain | % Done |
|--------|--------|
| Student Records | 90% |
| Programme & Curriculum | 85% |
| Admissions | 80% |
| Assessment & Marks | 85% |
| Finance | 75% |
| HESA Compliance | 70% |
| Audit & Security | 85% |

---

## 3. Next Phases (V → F → E → G)

| Phase | Focus |
|-------|-------|
| **V** | Equipment scheduling |
| **F** | ERP GL feed |
| **E** | PDF document pipeline |
| **G** | Research governance flag |

---

## 4. Key Repos

| Repo | Purpose |
|------|---------|
| [Maieus2](https://github.com/RJK134/Maieus2) | Primary FHE tool (most active) |
| [EquiSmile](https://github.com/RJK134/EquiSmile) | Vet app |
| [Shakespeare-is-Boring](https://github.com/RJK134/Shakespeare-is-Boring) | EdTech app |
| [Finance-App](https://github.com/RJK134/Finance-App) | Finance app |
| [Macbook](https://github.com/RJK134/Macbook) | MacBook config/scripts |
| [Routines](https://github.com/RJK134/Routines) | Routines automation |
| [English_Through_Practice](https://github.com/RJK134/English_Through_Practice) | ETP website |

---

*Karpathy fileset. Pair with: `MEMORY.md` (running state).*
