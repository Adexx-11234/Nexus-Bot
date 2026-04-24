// Authentication handler
class AuthHandler {
  constructor() {
    this.apiBase = ''
    this.init()
  }

  init() {
    this.setupForms()
    this.setupPasswordToggles()
    // wait for full page load including CDN scripts
    if (document.readyState === 'complete') {
      this.setupIntlTelInput()
    } else {
      window.addEventListener('load', () => this.setupIntlTelInput())
    }
  }

  setupIntlTelInput() {
    const phoneInput = document.getElementById('phone-number')
    if (!phoneInput) return

    if (this.iti) {
      this.iti.destroy()
      this.iti = null
    }

    this.iti = window.intlTelInput(phoneInput, {
      initialCountry: 'ng',
      separateDialCode: true,
      utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js',
      dropdownContainer: document.body
    })
  }

  setupForms() {
    // Login form
    const loginForm = document.getElementById('login-form')
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e))
    }

    // Register form
    const registerForm = document.getElementById('register-form')
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => this.handleRegister(e))
    }
  }

  setupPasswordToggles() {
    const toggleBtns = document.querySelectorAll('.password-toggle');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('data-target');
        const input = document.getElementById(targetId);

        if (input.type === 'password') {
          input.type = 'text';
          // Eye closed icon (svg representation for text open)
          this.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
        } else {
          input.type = 'password';
          // Eye open icon 
          this.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;
        }
      });
    });
  }

  async handleLogin(e) {
    e.preventDefault()

    let phoneNumber = document.getElementById('phone-number').value.trim()
    const password = document.getElementById('password').value

    // Get E.164 format if intl-tel-input is initialized
    if (this.iti && this.iti.isValidNumber()) {
      phoneNumber = this.iti.getNumber()
    } else if (this.iti) {
      // Fallback or handle invalid gracefully (relying on raw output)
      phoneNumber = this.iti.getNumber() || this.formatPhoneNumber(phoneNumber)
    } else {
      phoneNumber = this.formatPhoneNumber(phoneNumber)
    }

    if (!phoneNumber || !password) {
      this.showAlert('Please fill in all fields', 'error')
      return
    }

    this.setLoading(true, 'login-btn', 'Logging in...')

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, password })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        this.showAlert('Login successful! Redirecting...', 'success')
        setTimeout(() => {
          window.location.href = '/dashboard'
        }, 1000)
      } else {
        this.showAlert(data.error || 'Login failed', 'error')
      }
    } catch (error) {
      this.showAlert('Network error. Please try again.', 'error')
    } finally {
      this.setLoading(false, 'login-btn', 'Login')
    }
  }

  async handleRegister(e) {
    e.preventDefault()

    const firstName = document.getElementById('first-name').value.trim()
    let phoneNumber = document.getElementById('phone-number').value.trim()
    const password = document.getElementById('password').value
    const confirmPassword = document.getElementById('confirm-password').value

    // Get E.164 format if intl-tel-input is initialized
    if (this.iti && this.iti.isValidNumber()) {
      phoneNumber = this.iti.getNumber()
    } else if (this.iti) {
      phoneNumber = this.iti.getNumber() || this.formatPhoneNumber(phoneNumber)
    } else {
      phoneNumber = this.formatPhoneNumber(phoneNumber)
    }

    if (!phoneNumber || !password) {
      this.showAlert('Phone number and password are required', 'error')
      return
    }

    if (password !== confirmPassword) {
      this.showAlert('Passwords do not match', 'error')
      return
    }

    if (password.length < 8) {
      this.showAlert('Password must be at least 8 characters', 'error')
      return
    }

    this.setLoading(true, 'register-btn', 'Creating account...')

    try {
      const response = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, phoneNumber, password })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        this.showAlert('Account created successfully! Redirecting...', 'success')
        setTimeout(() => {
          window.location.href = '/dashboard'
        }, 1000)
      } else {
        this.showAlert(data.error || 'Registration failed', 'error')
      }
    } catch (error) {
      this.showAlert('Network error. Please try again.', 'error')
    } finally {
      this.setLoading(false, 'register-btn', 'Create Account')
    }
  }

  showAlert(message, type) {
    if (window.showAlert) {
      window.showAlert(message, type);
    } else {
      alert(message);
    }
  }

  setLoading(isLoading, btnId, text) {
    const btn = document.getElementById(btnId)
    if (!btn) return

    btn.disabled = isLoading
    btn.innerHTML = isLoading
      ? `<span class="spinner" style="width: 20px; height: 20px; border-width: 2px;"></span> ${text}`
      : text
  }

  formatPhoneNumber(phone) {
    // Remove all non-digit characters
    let cleaned = phone.replace(/\D/g, '')

    // Add + if not present
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned
    }

    return cleaned
  }
}

// Initialize auth handler
document.addEventListener('DOMContentLoaded', () => {
  window.authHandler = new AuthHandler()
})