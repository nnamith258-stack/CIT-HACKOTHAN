const notificationRegion = document.createElement('div');
notificationRegion.className = 'notification-region';
notificationRegion.setAttribute('role', 'log');
notificationRegion.setAttribute('aria-label', 'Notifications');
notificationRegion.setAttribute('aria-live', 'polite');
notificationRegion.setAttribute('aria-relevant', 'additions');
document.body.append(notificationRegion);

const notificationDetails = {
  success: { title: 'Done', icon: '✓', duration: 4500 },
  warning: { title: 'Please note', icon: '!', duration: 7000 },
  error: { title: 'Needs attention', icon: '!', duration: 9000 }
};

let notificationAudioContext;

function prepareNotificationAudio() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return;
  }

  if (!notificationAudioContext) {
    notificationAudioContext = new AudioContextConstructor();
  }

  if (notificationAudioContext.state === 'suspended') {
    notificationAudioContext.resume().catch((error) => {
      console.warn('Notification sound is unavailable:', error);
    });
  }

  document.removeEventListener('pointerdown', prepareNotificationAudio);
  document.removeEventListener('keydown', prepareNotificationAudio);
}

document.addEventListener('pointerdown', prepareNotificationAudio);
document.addEventListener('keydown', prepareNotificationAudio);

function playAttentionSound(type) {
  if (!notificationAudioContext || notificationAudioContext.state !== 'running') {
    return;
  }

  const startTime = notificationAudioContext.currentTime;
  const oscillator = notificationAudioContext.createOscillator();
  const volume = notificationAudioContext.createGain();
  const duration = 2;

  oscillator.type = 'triangle';
  oscillator.frequency.value = type === 'error' ? 520 : 660;
  volume.gain.setValueAtTime(0.0001, startTime);

  for (let pulse = 0; pulse < 5; pulse += 1) {
    const pulseStart = startTime + pulse * 0.4;
    volume.gain.setValueAtTime(0.0001, pulseStart);
    volume.gain.linearRampToValueAtTime(0.045, pulseStart + 0.025);
    volume.gain.setValueAtTime(0.045, pulseStart + 0.16);
    volume.gain.linearRampToValueAtTime(0.0001, pulseStart + 0.2);
  }

  oscillator.connect(volume);
  volume.connect(notificationAudioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

function dismissNotification(notification) {
  if (notification.classList.contains('is-leaving')) {
    return;
  }

  window.clearTimeout(notification.dismissTimer);
  notification.classList.add('is-leaving');
  window.setTimeout(() => notification.remove(), 180);
}

window.showNotification = (message, type = 'warning', variables = {}) => {
  const details = notificationDetails[type] || notificationDetails.warning;
  const notificationType = type in notificationDetails ? type : 'warning';
  const translate = window.t || ((text) => text);
  const notification = document.createElement('section');
  notification.className = `notification is-${notificationType}`;
  notification.setAttribute('role', notificationType === 'error' ? 'alert' : 'status');
  notification.dataset.sourceMessage = window.getEnglishSource
    ? window.getEnglishSource(message)
    : message;
  notification.dataset.variables = JSON.stringify(variables);

  const icon = document.createElement('span');
  icon.className = 'notification-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = details.icon;

  const content = document.createElement('span');
  content.className = 'notification-content';

  const title = document.createElement('span');
  title.className = 'notification-title';
  title.textContent = translate(details.title);

  const text = document.createElement('span');
  text.className = 'notification-message';
  text.textContent = translate(notification.dataset.sourceMessage, variables);
  content.append(title, text);

  const closeButton = document.createElement('button');
  closeButton.className = 'notification-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', translate('Dismiss notification'));
  closeButton.textContent = '×';
  closeButton.addEventListener('click', () => dismissNotification(notification));

  notification.append(icon, content, closeButton);
  notificationRegion.append(notification);

  if (notificationType === 'warning' || notificationType === 'error') {
    playAttentionSound(notificationType);
  }

  const startDismissTimer = () => {
    window.clearTimeout(notification.dismissTimer);
    notification.dismissTimer = window.setTimeout(
      () => dismissNotification(notification),
      details.duration
    );
  };

  notification.addEventListener('mouseenter', () => window.clearTimeout(notification.dismissTimer));
  notification.addEventListener('mouseleave', startDismissTimer);
  notification.addEventListener('focusin', () => window.clearTimeout(notification.dismissTimer));
  notification.addEventListener('focusout', (event) => {
    if (!notification.contains(event.relatedTarget)) {
      startDismissTimer();
    }
  });
  startDismissTimer();
};

window.addEventListener('devicelink-language-change', () => {
  const translate = window.t || ((text) => text);
  notificationRegion.setAttribute('aria-label', translate('Notifications'));

  for (const notification of notificationRegion.querySelectorAll('.notification')) {
    const title = notification.querySelector('.notification-title');
    const message = notification.querySelector('.notification-message');
    const closeButton = notification.querySelector('.notification-close');
    let variables = {};
    try {
      variables = JSON.parse(notification.dataset.variables || '{}');
    } catch (error) {
      console.error('Could not restore notification variables:', error);
    }
    const type = [...notification.classList]
      .find((name) => name.startsWith('is-'))?.slice(3);
    title.textContent = translate(notificationDetails[type]?.title || 'Please note');
    message.textContent = translate(notification.dataset.sourceMessage, variables);
    closeButton.setAttribute('aria-label', translate('Dismiss notification'));
  }
});
