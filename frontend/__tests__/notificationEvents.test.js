import {
  publishNotificationEvent,
  subscribeNotificationEvents,
} from '../src/notifications/events';

describe('notification event stream', () => {
  test('publishes one presentation when push and inbox carry the same event id', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeNotificationEvents(listener);
    const eventId = `event-${Date.now()}-${Math.random()}`;

    publishNotificationEvent({ event_id: eventId, category: 'defended' });
    publishNotificationEvent({
      id: 'inbox-row',
      category: 'defended',
      data: { event_id: eventId, category: 'defended' },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('unsubscribe stops future presentations', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeNotificationEvents(listener);
    unsubscribe();

    publishNotificationEvent({ event_id: `later-${Date.now()}` });
    expect(listener).not.toHaveBeenCalled();
  });

  test('an event published before hosts mount is not consumed', () => {
    const eventId = `startup-${Date.now()}-${Math.random()}`;
    publishNotificationEvent({ event_id: eventId, category: 'stolen' });

    const listener = jest.fn();
    const unsubscribe = subscribeNotificationEvents(listener);
    publishNotificationEvent({ event_id: eventId, category: 'stolen' });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
