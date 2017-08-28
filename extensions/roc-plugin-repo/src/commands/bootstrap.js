import fs from 'fs-extra';
import path from 'path';
import { execute } from 'roc';
import log from 'roc/log/default/small';
import onExit from 'signal-exit';
import readPkg from 'read-pkg';
import writePkg from 'write-pkg';
import Listr from 'listr';
import isCI from 'is-ci';
import { createLink, createBinaryLink } from './utils/install';
import generateStatus from '../semver/generateStatus';
import { getNextVersions, createVersionsDoesNotMatch } from '../semver/utils';

const removeDependencies = (
  dependencies = {},
  localDependencies,
  ignoreSemVer,
) => {
  const newDependencies = {};

  const removeDependenciesThatShouldBeLinked = createVersionsDoesNotMatch(
    localDependencies,
    dependencies,
    ignoreSemVer,
  );

  Object.keys(dependencies)
    .filter(removeDependenciesThatShouldBeLinked)
    .forEach(dependency => {
      newDependencies[dependency] = dependencies[dependency];
    });

  return newDependencies;
};

const install = async (
  project,
  binary,
  localDependencies,
  { ignoreSemVer, verbose },
) => {
  const pathToPackageJSON = path.join(project.path, 'package.json');
  const pathToPackageJSONBackup = `${pathToPackageJSON}.backup`;
  const packageJSON = readPkg.sync(pathToPackageJSON);
  const tempPackageJSON = Object.assign({}, packageJSON);

  tempPackageJSON.dependencies = removeDependencies(
    packageJSON.dependencies,
    localDependencies,
    ignoreSemVer,
  );
  tempPackageJSON.devDependencies = removeDependencies(
    packageJSON.devDependencies,
    localDependencies,
    ignoreSemVer,
  );

  await fs.rename(pathToPackageJSON, pathToPackageJSONBackup);

  await writePkg(pathToPackageJSON, tempPackageJSON);

  const restorePackageJSON = () =>
    fs.renameSync(pathToPackageJSONBackup, pathToPackageJSON);

  const unregister = onExit(restorePackageJSON);

  return execute(`cd ${project.path} && ${binary} install`, {
    silent: !verbose,
  }).then(
    () => {
      restorePackageJSON();
      unregister();
    },
    error => {
      restorePackageJSON();
      unregister();
      throw error;
    },
  );
};

const link = async (project, binary, localDependencies, { concurrent }) => {
  const pathToPackageJSON = path.join(project.path, 'package.json');

  const packageJSON = await readPkg(pathToPackageJSON);
  const toLink = Object.keys({
    ...packageJSON.dependencies,
    ...packageJSON.devDependencies,
  }).filter(dependency => Object.keys(localDependencies).includes(dependency));

  if (toLink.length === 0) {
    return Promise.resolve();
  }

  return new Listr(
    toLink.map(dependency => ({
      title: dependency,
      task: async () => {
        await fs.ensureDir(
          `${project.path}/node_modules/${dependency}`
            .split(path.sep)
            .slice(0, -1)
            .join(path.sep),
        );

        await createLink(
          localDependencies[dependency].path,
          `${project.path}/node_modules/${dependency}`,
          'junction',
        );

        if (localDependencies[dependency].packageJSON.bin) {
          return createBinaryLink(
            localDependencies[dependency].path,
            `${project.path}/node_modules/`,
            dependency,
            localDependencies[dependency].packageJSON.bin,
          );
        }

        return Promise.resolve();
      },
    })),
    { concurrent },
  );
};

export default projects => async ({
  arguments: { managed: { projects: selectedProjects } },
  options: { managed: { linkAll, concurrent } },
  context,
}) => {
  const binary = context.config.settings.repo.npmBinary;
  const verbose = context.verbose;
  const selected = projects.filter(
    ({ name }) => !selectedProjects || selectedProjects.includes(name),
  );
  // If we want to link all project we will ignore the semvers
  const ignoreSemVer = linkAll;

  if (selected.length === 0) {
    return log.warn('No projects were found');
  }

  const status =
    ignoreSemVer || context.config.settings.repo.mono === false
      ? {}
      : await generateStatus(projects, true);

  const localDependencies = getNextVersions(status, projects);

  return new Listr(
    [
      {
        title: 'Installing dependencies',
        task: () =>
          new Listr(
            selected.map(project => ({
              title: project.name,
              task: () =>
                install(project, binary, localDependencies, {
                  ignoreSemVer,
                  verbose,
                }),
            })),
            { concurrent },
          ),
      },
      {
        title: 'Linking local dependencies',
        task: () =>
          new Listr(
            selected.map(project => ({
              title: project.name,
              task: () =>
                link(project, binary, localDependencies, { concurrent }),
            })),
            { concurrent },
          ),
      },
    ],
    { renderer: isCI ? 'verbose' : 'default' },
  ).run();
};
