# Security Policy

## Supported Versions

This project uses a continuous deployment model. Only the latest version on the `main` branch is actively maintained and receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| Latest `main` | :white_check_mark: |
| Older releases | :x:                |

## Reporting a Vulnerability

**Please DO NOT report security vulnerabilities through public GitHub issues.**

If you discover a potential security vulnerability in this project, we kindly ask you to report it privately.

- **How to report:** Use GitHub's [Private Vulnerability Reporting](https://github.com/wyk-maths-team/source-code/security/advisories/new) feature.
- **What to expect:** 
  - We will acknowledge receipt of your vulnerability report within 3 business days.
  - We will provide an estimated timeline for a fix.
  - You will be credited for your discovery once the vulnerability is patched and disclosed (if you wish).

## Rules of Engagement (For White Hat Hackers)

This is an educational platform built by a student for a school mathematics team. If you are conducting security research, please follow these rules:

1. **DO NOT** exploit vulnerabilities to delete, modify, or exfiltrate student data.
2. **DO NOT** perform Denial of Service (DoS/DDoS) attacks that disrupt normal student usage.
3. **DO NOT** test vulnerabilities on other users' accounts without their explicit permission.
4. **Harmless PoCs are welcome.** If you find an XSS (e.g., forced logout) or an IDOR, please provide a minimal reproducible PoC in your report instead of causing damage.

## Scope

### In Scope
- Cross-Site Scripting (XSS)
- Authentication/Authorization bypass (e.g., accessing admin endpoints as a student)
- Insecure Direct Object References (IDOR)
- Server-Side Request Forgery (SSRF)
- SQL/NoSQL Injection

### Out of Scope
- Missing security headers that do not lead to a direct exploit.
- Vulnerabilities in third-party dependencies (please report those to the upstream project).
- Automated tool output without a valid exploit path.

---
*Thank you for helping keep this platform and its students safe.*
