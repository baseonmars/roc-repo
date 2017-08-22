import conventionalChangelog from 'conventional-changelog';

import { isBreakingChange, versions } from './utils';

export default function generateStatus(projects, isMonorepo, from) {
  return new Promise(resolve => {
    const status = {};

    projects.forEach(project => {
      status[project.name] = {
        increment: versions.NOTHING,
        commits: [],
        path: project.path,
        newVersion: undefined,
        packageJSON: project.packageJSON,
      };
    });

    conventionalChangelog(
      {
        preset: 'angular',
        append: true,
        transform(commit, cb) {
          // We are only interested in commits which scope is one of our projects
          if (
            isMonorepo &&
            !projects.find(({ name }) => name === commit.scope)
          ) {
            cb();
            return;
          }

          const project = isMonorepo ? commit.scope : projects[0].name;
          let toPush = null;
          if (commit.type === 'fix' || commit.type === 'perf') {
            // TODO Documented
            status[project].increment = Math.max(
              status[project].increment,
              versions.PATCH,
            );
            toPush = commit;
          }
          if (commit.type === 'feat') {
            status[project].increment = Math.max(
              status[project].increment,
              versions.MINOR,
            );
            toPush = commit;
          }
          if (isBreakingChange(commit)) {
            status[project].increment = Math.max(
              status[project].increment,
              versions.MAJOR,
            );
            toPush = commit;
          }
          if (toPush) {
            status[project].commits.push(commit);
          }
          if (commit.type === 'release' && commit.scope === project) {
            status[project].increment = versions.NOTHING;
            status[project].commits = [];
          }
          cb();
        },
      },
      {},
      { reverse: true, from },
    )
      .on('end', () => {
        Object.keys(status).forEach(project => {
          if (status[project].increment === versions.NOTHING) {
            delete status[project];
          }
        });
        resolve(status);
      })
      .resume();
  });
}
