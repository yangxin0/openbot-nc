const fs = require("node:fs");
const path = require("node:path");
const plist = require("@expo/plist").default;
const { withDangerousMod, withPlugins, withXcodeProject } = require("expo/config-plugins");

const TARGET_NAME = "expo-sharing-extension";

/** @param {string} file @param {(value: Record<string, any>) => void} change */
function changePlist(file, change) {
  const value = plist.parse(fs.readFileSync(file, "utf8"));
  change(value);
  fs.writeFileSync(file, plist.build(value));
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withExtensionName = (config) =>
  withDangerousMod(config, [
    "ios",
    (mod) => {
      const directory = path.join(mod.modRequest.platformProjectRoot, TARGET_NAME);
      changePlist(path.join(directory, "Info.plist"), (info) => {
        info.CFBundleDisplayName = mod.name;
      });
      return mod;
    },
  ]);

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withExtensionTeam = (config) =>
  withXcodeProject(config, (mod) => {
    if (!mod.ios?.appleTeamId) return mod;
    const project = mod.modResults;
    const objects = project.hash.project.objects;
    const target = project.pbxTargetByName(TARGET_NAME) ?? project.pbxTargetByName(`"${TARGET_NAME}"`);
    if (!target) throw new Error(`The Xcode project has no ${TARGET_NAME} target.`);
    const sections = project.pbxXCBuildConfigurationSection();
    const configurations = objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations;
    for (const { value } of configurations) sections[value].buildSettings.DEVELOPMENT_TEAM = mod.ios.appleTeamId;
    return mod;
  });

/** @type {import('expo/config-plugins').ConfigPlugin<{ ios?: { enabled?: boolean } } | undefined>} */
const withShareTarget = (config, props) => {
  if (!props?.ios?.enabled) return withPlugins(config, [["expo-sharing", props]]);
  return withPlugins(withExtensionTeam(withExtensionName(config)), [["expo-sharing", props]]);
};

module.exports = withShareTarget;
