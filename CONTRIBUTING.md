# Contributing

Contributions that fix bugs, improve documentation, or enhance the recommendation service are welcome. For larger changes, open an issue describing the use case and expected behavior first so the scope can be discussed.

## Local development

1. Use Node.js 24 or later.
2. Follow [README.md](README.md) to copy `.env.example` to `.env` and enter your own keys and Model Studio configuration.
3. Run `npm ci` to install dependencies, then `npm test` to run the existing tests.
4. Start the local API with `npm start`. Use your own Model Studio account for real model calls and keep test data out of the production instance.

## Submitting changes

- Keep each pull request focused on one problem. Explain the trigger, resulting behavior, and validation performed.
- Update the README, example configuration, and deployment documentation when changing an API or configuration.
- Add meaningful tests for behavior changes and run `npm test` before submitting.
- After staging the files intended for publication, run `npm run check:public` to check staged content and local files for common credential leaks.
- Do not commit `.env`, API keys, private certificate keys, databases, product photos, or real user data. Use synthetic content and separate data directories for tests.
- Keep `package-lock.json` updated when changing dependencies and explain the purpose of new dependencies.

Do not disclose credentials or exploitable security issues in public issues or pull requests. Follow [SECURITY.md](SECURITY.md) instead.

By contributing, you agree to release your contribution under the project's [MIT License](LICENSE).
