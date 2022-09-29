# Klotho slack-notifier bot

A GitHub → Slack notification bot that emphasizes a signal-to-noise ratio. Our bot posts pull request notifications in a thread (one thread per pull request) to keep the chatter down and let you actually keep track of what's going on.

![a single message for a pull request, with updates in the message thread](docs/images/slackbot-thread.png)

To get up and running quickly, see our [installation tutorial][tutorial].

# Building and deploying

### Requirements

- [Klotho CLI](https://klo.dev/docs/tutorials/built_with_klotho/slackbot)
- Node.js 14.x+ (& NPM)

### Building

```bash
npm run klotho build
```

This will compile the TypeScript, run the tests, and run Klotho on the application.

### Deploying

1. Just once, run:

   ```bash
   npm run klotho pulumi config set aws:region <YOUR DESIRED REGION> # e.g. us-east-1
   ```
2. Make sure you have your env set up with AWS credentials (see [our tutorial][tutorial-aws].
3. ```bash
   npm run klotho pulumi up
   ```

### Different application names

By default, the Klotho application name (`klotho --app ...`) is `klotho-slack-notifier-bot`, and Klotho will compile to a directory `./compiled`.

To change this, set an env variable `KLOTHO_APP_NAME`. If you do, the application name will be what you set in that variable, and Klotho will compile to `./compiled-klotho/$KLOTHO_APP_NAME`.

# Contributing

We welcome pull requests, or you can open an issue to provide feedback or make a suggestion. You can also find us at our [Discord server](https://discord.com/invite/4z2jwRvnyM).

We don't have any formal contribution requirements or style guides yet for pull requests. Please:

* format your code reasonably
* add unit tests if reasonable

[tutorial]: https://klo.dev/docs/tutorials/slackbot
[tutorial-aws]: http://klo.dev/docs/tutorials/built_with_klotho/slackbot#prerequisites
