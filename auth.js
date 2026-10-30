const signInForm = document.getElementById('sign-in-form');
const passwordInput = document.getElementById('password');
const passwordToggle = document.getElementById('password-toggle');
const formMessage = document.getElementById('form-message');
let validationNotificationQueued = false;

passwordToggle.addEventListener('click', () => {
  const isPasswordHidden = passwordInput.type === 'password';
  passwordInput.type = isPasswordHidden ? 'text' : 'password';
  passwordToggle.textContent = isPasswordHidden ? 'HIDE' : 'SHOW';
  passwordToggle.setAttribute('aria-label', isPasswordHidden ? 'Hide password' : 'Show password');
  passwordToggle.setAttribute('aria-pressed', String(isPasswordHidden));
});

signInForm.addEventListener('invalid', () => {
  if (!validationNotificationQueued) {
    validationNotificationQueued = true;
    window.showNotification('Enter your username and password before continuing.', 'warning');
    window.setTimeout(() => {
      validationNotificationQueued = false;
    }, 0);
  }
}, true);

signInForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = 'This sign-in screen is a UI preview only. No credentials were checked or saved.';
  formMessage.textContent = message;
  window.showNotification(message, 'warning');
});
