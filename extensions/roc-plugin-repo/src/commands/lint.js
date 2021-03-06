import path from 'path';

import { execute, fileExists } from 'roc';
import log from 'roc/log/default/small';

const eslint = require.resolve('eslint/bin/eslint');

const eslintCommand = (project, fix, config, ignorePattern, ignoreFile) =>
  `${eslint} ${config}${project.path} --ignore-path '${ignoreFile}' --ignore-pattern '${ignorePattern}' ${fix
    ? '--fix'
    : ''}`;

export default projects => ({
  arguments: { managed: { projects: selectedProjects } },
  options: { managed: { fix, forceDefault } },
  context,
}) => {
  const settings = context.config.settings.repo;
  const selected = projects.filter(
    ({ name }) => !selectedProjects || selectedProjects.includes(name),
  );

  if (selected.length === 0) {
    return log.warn('No projects were found');
  }

  let config;
  if (fileExists('.eslintrc', context.directory) && !forceDefault) {
    log.info(
      'A local ESLint configuration was detected and will be used over the default.\n',
    );
    config = '';
  } else {
    config = `--config ${require.resolve('../configuration/eslintrc.js')} `;
  }

  let ignoreFile;
  if (fileExists('.eslintignore', context.directory) && !forceDefault) {
    log.info(
      'A local ESLint ignore file was detected and will be used over the default.\n',
    );
    ignoreFile = path.join(context.directory, '.eslintignore');
  } else {
    ignoreFile = require.resolve('../configuration/eslintignore');
  }

  return Promise.all(
    selected
      .map(project => {
        const ignorePattern = path.join(
          path.relative(
            context.directory,
            path.resolve(project.path, settings.output),
          ),
          '*',
        );

        return execute(
          eslintCommand(project, fix, config, ignorePattern, ignoreFile),
        );
      })
      .map(promise => promise.then(() => 0, () => 1)),
  ).then(results => {
    const status = results.reduce((previous, current) =>
      Math.max(previous, current),
    );
    if (status === 1) {
      process.exitCode = 1;
      log.error('Linting failed.');
    } else {
      log.success('Linting succeeded.');
    }
  });
};
