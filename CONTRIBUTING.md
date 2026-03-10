# Contributing to @finsys/lender-client

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for everyone. We pledge to make participation in this project a harassment-free experience, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Expected Behavior

- Be respectful and considerate in all interactions
- Provide constructive feedback
- Accept constructive criticism gracefully
- Focus on what is best for the community and the project

### Unacceptable Behavior

- Harassment, intimidation, or discrimination in any form
- Trolling, insulting, or derogatory comments
- Publishing others' private information without permission
- Any conduct that would be considered inappropriate in a professional setting

### Enforcement

Project maintainers may remove, edit, or reject contributions that do not align with this Code of Conduct. Instances of unacceptable behavior may be reported by contacting the project team. All complaints will be reviewed and investigated.

## How to Contribute

### Reporting Issues

- Check existing issues before creating a new one
- Use a clear, descriptive title
- Include steps to reproduce the issue
- Include the environment (Node.js version, OS, etc.)

### Pull Requests

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Ensure TypeScript compiles without errors: `npm run typecheck`
5. Submit a pull request with a clear description of the changes

### Development Setup

```bash
git clone https://github.com/ExtraGalaxies/finsys-lender-client.git
cd finsys-lender-client
npm install
npm run typecheck
npm run build
```

### Code Style

- TypeScript with strict mode
- 2-space indentation
- Single quotes
- No semicolons (Prettier default)
- ESM modules (`import`/`export`)

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
