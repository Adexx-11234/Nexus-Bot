// Theme management
class ThemeManager {
  constructor() {
    this.theme = localStorage.getItem('theme') || 'light'
    this.init()
  }

  init() {
    this.applyTheme()
    this.setupToggle()
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme)
    this.updateToggleIcon()
  }

  toggleTheme() {
    this.theme = this.theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('theme', this.theme)
    this.applyTheme()
  }

  updateToggleIcon() {
    const toggleBtn = document.getElementById('theme-toggle')
    if (toggleBtn) {
      toggleBtn.innerHTML = this.theme === 'light' ? '🌙' : '☀️'
    }
  }

  setupToggle() {
    const toggleBtn = document.getElementById('theme-toggle')
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggleTheme())
    }
  }

  setupScrollAnimations() {
    const elements = document.querySelectorAll('.animate-on-scroll')

    // On mobile, just show everything immediately
    if (window.innerWidth <= 768) {
      elements.forEach(el => el.classList.add('is-visible'))
      return
    }

    const observer = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, {
      root: null,
      rootMargin: '0px',
      threshold: 0.1
    })

    elements.forEach(el => observer.observe(el))
  }

  showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-message">${message}</div>
      <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove toast after duration
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentElement) {
          toast.parentElement.removeChild(toast);
        }
      }, 400); // Wait for slide out animation
    }, 5000);
  }
}

// Global alert method bridge
window.showAlert = function (message, type) {
  if (window.themeManager && window.themeManager.showToast) {
    window.themeManager.showToast(message, type);
  } else {
    alert(message);
  }
};

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', () => {
  window.themeManager = new ThemeManager();
  window.themeManager.setupScrollAnimations();
});