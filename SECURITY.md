# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this package, please report it responsibly.

**Do not open a public issue.** Instead, please email security concerns to the project maintainers through GitHub's private vulnerability reporting feature on this repository.

## Scope

This package is a client library that communicates with the FinSys Lender API. Security concerns may include:

- Credential or token leakage
- Improper handling of sensitive data (PII)
- Injection vulnerabilities in request construction
- Insecure defaults in retry or timeout configuration

## Handling of Sensitive Data

This package handles API credentials (client ID, client secret, subscription key) and authentication tokens in memory only. It does not persist credentials to disk or logs. Application data retrieved through the API may contain personally identifiable information (PII) — consumers are responsible for handling this data in compliance with applicable privacy regulations.
