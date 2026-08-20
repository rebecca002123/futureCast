// app.json holds the static config; this file only adds the values that have
// to come from the environment.
//
// The widget extension has to be code-signed with your Apple Team ID, which
// @bacons/apple-targets reads from `ios.appleTeamId`. Set APPLE_TEAM_ID as an
// EAS environment variable (or export it locally before `npx expo prebuild`),
// or paste it straight into app.json under `expo.ios.appleTeamId`. Without it
// the app still builds — you'll just get a warning from the plugin and the
// widget target may fail to sign.

module.exports = ({ config }) => {
  const appleTeamId = process.env.APPLE_TEAM_ID || config.ios?.appleTeamId;

  return {
    ...config,
    ios: {
      ...config.ios,
      ...(appleTeamId ? { appleTeamId } : null),
    },
  };
};
