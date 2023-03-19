import { execa } from 'execa';
import {
  GenerateCommitMessageErrorEnum,
  generateCommitMessageWithChatCompletion
} from '../generateCommitMessageFromGitDiff';
import {
  assertGitRepo,
  getChangedFiles,
  getDiff,
  getStagedFiles,
  gitAdd
} from '../utils/git';
import {
  spinner,
  confirm,
  outro,
  isCancel,
  intro,
  multiselect, text
} from '@clack/prompts';
import chalk from 'chalk';
import { trytm } from '../utils/trytm';

const generateCommitMessageFromGitDiff = async (
  diff: string,
  aiNotes: string = ''
): Promise<void> => {
  await assertGitRepo();

  const commitSpinner = spinner();
  commitSpinner.start('Generating the commit message');
  const commitMessage = await generateCommitMessageWithChatCompletion(diff, aiNotes || "");

  // TODO: show proper error messages
  if (typeof commitMessage !== 'string') {
    const errorMessages = {
      [GenerateCommitMessageErrorEnum.emptyMessage]:
        'empty openAI response, weird, try again',
      [GenerateCommitMessageErrorEnum.internalError]:
        'internal error, try again',
      [GenerateCommitMessageErrorEnum.tooMuchTokens]:
        'too much tokens in git diff, stage and commit files in parts'
    };

    outro(`${chalk.red('✖')} ${errorMessages[commitMessage.error]}`);
    process.exit(1);
  }

  commitSpinner.stop('📝 Commit message generated');

  outro(
    `Commit message:
${chalk.grey('——————————————————')}
${commitMessage}
${chalk.grey('——————————————————')}`
  );

  const isCommitConfirmedByUser = await confirm({
    message: 'Confirm the commit message'
  });

  if (isCommitConfirmedByUser && !isCancel(isCommitConfirmedByUser)) {
    const { stdout } = await execa('git', ['commit', '-m', commitMessage]);

    outro(`${chalk.green('✔')} successfully committed`);

    outro(stdout);

    const isPushConfirmedByUser = await confirm({
      message: 'Do you want to run `git push`?'
    });

    if (isPushConfirmedByUser && !isCancel(isPushConfirmedByUser)) {
      const pushSpinner = spinner();

      pushSpinner.start('Running `git push`');
      const { stdout } = await execa('git', ['push']);
      pushSpinner.stop(`${chalk.green('✔')} successfully pushed all commits`);

      if (stdout) outro(stdout);
    }
  } else outro(`${chalk.gray('✖')} process cancelled`);
};

export async function commit(isStageAllFlag = false) {
  if (isStageAllFlag) {
    const changedFiles = await getChangedFiles();
    if (changedFiles) await gitAdd({ files: changedFiles });
    else {
      outro('No changes detected, write some code and run `oc` again');
      process.exit(1);
    }
  }

  const [stagedFiles, errorStagedFiles] = await trytm(getStagedFiles());
  const [changedFiles, errorChangedFiles] = await trytm(getChangedFiles());

  if (!changedFiles?.length && !stagedFiles?.length) {
    outro(chalk.red('No changes detected'));
    process.exit(1);
  }

  intro('open-commit');
  if (errorChangedFiles ?? errorStagedFiles) {
    outro(`${chalk.red('✖')} ${errorChangedFiles ?? errorStagedFiles}`);
    process.exit(1);
  }

  const stagedFilesSpinner = spinner();
  stagedFilesSpinner.start('Counting staged files');

  if (!stagedFiles.length) {
    stagedFilesSpinner.stop('No files are staged');
    const isStageAllAndCommitConfirmedByUser = await confirm({
      message: 'Do you want to stage all files and generate commit message?'
    });

    if (
      isStageAllAndCommitConfirmedByUser &&
      !isCancel(isStageAllAndCommitConfirmedByUser)
    ) {
      await commit(true);
      process.exit(1);
    }

    if (stagedFiles.length === 0 && changedFiles.length > 0) {
      const files = (await multiselect({
        message: chalk.cyan('Select the files you want to add to the commit:'),
        options: changedFiles.map((file) => ({
          value: file,
          label: file
        }))
      })) as string[];

      if (isCancel(files)) process.exit(1);

      await gitAdd({ files });
    }

    await commit(false);
    process.exit(1);
  }

  const isAiNotes = await confirm({
    message: 'Do you want to pass any notes to the AI?'
  })
  let aiNotes = ''
  if (isAiNotes) {
    aiNotes = await text({
      message: 'Please enter any text you want to pass:',
      validate(value) {
        if (value.length === 0) return `Value is required!`;
      },
    }) as string
  }

  stagedFilesSpinner.stop(
    `${stagedFiles.length} staged files:\n${stagedFiles
      .map((file) => `  ${file}`)
      .join('\n')}`
  );

  const [, generateCommitError] = await trytm(
    generateCommitMessageFromGitDiff(await getDiff({ files: stagedFiles }), aiNotes || "")
  );

  if (generateCommitError) {
    outro(`${chalk.red('✖')} ${generateCommitError}`);
    process.exit(1);
  }

  process.exit(0);
}
