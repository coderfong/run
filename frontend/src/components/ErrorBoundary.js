// Per-tab error boundary. Catches render crashes in a tab's stack, reports
// to Sentry (if configured), and shows a retry state instead of a white
// screen. Retry re-mounts the subtree.

import React from 'react';
import * as Sentry from '@sentry/react-native';
import { TriangleAlert } from 'lucide-react-native';

import { colors } from '../theme';
import Screen from './ui/Screen';
import EmptyState from './ui/EmptyState';

export default class ErrorBoundary extends React.Component {
  state = { error: null, key: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    try {
      Sentry.captureException(error);
    } catch {}
  }

  reset = () => this.setState((s) => ({ error: null, key: s.key + 1 }));

  render() {
    if (this.state.error) {
      return (
        <Screen center>
          <EmptyState
            icon={<TriangleAlert size={40} color={colors.warn} />}
            title="Something went wrong"
            body="This screen hit a snag. Try again. Your runs and territory are safe."
            actionLabel="Try again"
            onAction={this.reset}
          />
        </Screen>
      );
    }
    return <React.Fragment key={this.state.key}>{this.props.children}</React.Fragment>;
  }
}
