# Klotho slack-notifier bot

A GitHub → Slack notification bot that emphasizes a signal-to-noise ratio. Our bot posts pull request notifications in a thread (one thread per pull request) to keep the chatter down and let you actually keep track of what's going on.

![a single message for a pull request, with updates in the message thread](docs/images/slackbot-thread.png)

To get up and running quickly, see our [installation tutorial][tutorial].

# Building and deploying

### Requirements

- [Klotho CLI](https://klo.dev/docs-v1/tutorials/getting_started_with_klotho#installing-the-cli)
- Node.js 14.x+ (& NPM)

### Building

Just once (or whenever we add new dependencies):

```bash
npm install
```

Then, to build:

```bash
npm run klotho:build
```

### Deploying

Assuming you [have your Pulumi stack configured][config]:

```bash
npm run klotho:deploy
```

# Contributing

We welcome pull requests, or you can open an issue to provide feedback or make a suggestion. You can also find us at our [Discord server](https://discord.com/invite/4z2jwRvnyM).

We don't have any formal contribution requirements or style guides yet for pull requests. Please:

* format your code reasonably
* add unit tests if reasonable

[tutorial]: https://klo.dev/docs-v1/tutorials/slackbot
[config]: http://localhost:3000/docs-v1/tutorials/slackbot#building-and-deploying-the-application
