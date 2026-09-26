# Architecture — CYBERSHIELD 3.1.8 Phase 3

```text
Browser
  ├─ document/camera capture
  └─ raw evidence only
          ↓
TanStack Start server
  ├─ document OCR/parser
  ├─ trusted biometric service
  │   ├─ YuNet
  │   ├─ PASS3D
  │   ├─ passive PAD
  │   └─ portrait extraction + SFace
  ├─ identity-provider boundary
  ├─ server-configured watchlist
  └─ risk/evidence fusion
          ↓
Authoritative CaseRecord
          ↓
Browser display
```

The browser is not an authority for biometric results, risk scores, decisions, or watchlist hits. Browser case history is intentionally not persisted as authoritative state.
