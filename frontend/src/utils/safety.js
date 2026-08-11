import { Alert } from 'react-native';

import { api } from '../api/client';
import { toast } from '../ui/toast';

const REASONS = [
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate or offensive content'],
  ['sexual', 'Sexual content'],
  ['spam', 'Spam or scam'],
];

async function submitReport(userId, username, reason, context) {
  try {
    const detail = context ? `${reason}; context: ${context}` : reason;
    await api.reportUser(userId, 'content_report', detail, null);
    toast.success('Report sent. Thanks for helping keep PASER safe.');
  } catch (error) {
    toast.error(error.message || `Could not report ${username}`);
  }
}

function chooseReportReason(userId, username, context) {
  Alert.alert(
    `Report ${username}?`,
    'Choose the issue. A moderator will review the account and the reported context.',
    [
      ...REASONS.map(([key, label]) => ({
        text: label,
        onPress: () => submitReport(userId, username, key, context),
      })),
      { text: 'Cancel', style: 'cancel' },
    ]
  );
}

function confirmBlock(userId, username, onBlocked) {
  Alert.alert(
    `Block ${username}?`,
    'You will no longer see each other in feeds, comments, club chat, or Crossed Paths.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.blockUser(userId);
            toast.success(`${username} blocked`);
            onBlocked?.(userId);
          } catch (error) {
            toast.error(error.message || `Could not block ${username}`);
          }
        },
      },
    ]
  );
}

export function openSafetyActions({ userId, username = 'this runner', context, onBlocked }) {
  if (!userId) return;
  Alert.alert(
    `Safety options for ${username}`,
    'Reports are private. Blocking also hides this runner across social features.',
    [
      { text: 'Report', onPress: () => chooseReportReason(userId, username, context) },
      { text: 'Block', style: 'destructive', onPress: () => confirmBlock(userId, username, onBlocked) },
      { text: 'Cancel', style: 'cancel' },
    ]
  );
}
