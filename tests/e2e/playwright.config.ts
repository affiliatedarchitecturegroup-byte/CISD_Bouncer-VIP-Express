// ===========================================
// E2E Test Suite - Playwright
// ===========================================

import { test, expect, Page, Browser, BrowserContext } from '@playwright/test';
import { chromium } from 'playwright';

// ===========================================
// Test Configuration
// ===========================================

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_URL = process.env.E2E_API_URL || 'http://localhost:3001';

// ===========================================
// Fixtures
// ===========================================

test.describe('Bouncer VIP Platform E2E Tests', () => {
  let page: Page;
  let browser: Browser;
  let context: BrowserContext;

  test.beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await browser.close();
  });

  test.beforeEach(async () => {
    await page.goto(BASE_URL);
  });

  // ===========================================
  // Authentication Tests
  // ===========================================

  test.describe('Authentication', () => {
    test('Login with valid credentials', async () => {
      await page.fill('[data-testid="email"]', 'admin@bouncervip.com');
      await page.fill('[data-testid="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
    });

    test('Login with invalid credentials', async () => {
      await page.fill('[data-testid="email"]', 'invalid@test.com');
      await page.fill('[data-testid="password"]', 'wrongpassword');
      await page.click('[data-testid="login-button"]');
      
      await expect(page.locator('[data-testid="error-message"]')).toContainText('Invalid credentials');
    });

    test('Logout functionality', async () => {
      // Login first
      await page.fill('[data-testid="email"]', 'admin@bouncervip.com');
      await page.fill('[data-testid="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      
      // Then logout
      await page.click('[data-testid="user-menu"]');
      await page.click('[data-testid="logout-button"]');
      
      await expect(page).toHaveURL(/\/login/);
    });

    test('Password reset flow', async () => {
      await page.click('[data-testid="forgot-password-link"]');
      await page.fill('[data-testid="email"]', 'user@test.com');
      await page.click('[data-testid="reset-button"]');
      
      await expect(page.locator('[data-testid="success-message"]')).toContainText('Reset link sent');
    });
  });

  // ===========================================
  // Dashboard Tests
  // ===========================================

  test.describe('Dashboard', () => {
    test.beforeEach(async () => {
      // Login as admin
      await page.goto(`${BASE_URL}/login`);
      await page.fill('[data-testid="email"]', 'admin@bouncervip.com');
      await page.fill('[data-testid="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.waitForURL(/\/dashboard/);
    });

    test('Dashboard loads with stats', async () => {
      await expect(page.locator('[data-testid="stat-officers"]')).toBeVisible();
      await expect(page.locator('[data-testid="stat-venues"]')).toBeVisible();
      await expect(page.locator('[data-testid="stat-bookings"]')).toBeVisible();
      await expect(page.locator('[data-testid="stat-revenue"]')).toBeVisible();
    });

    test('Dashboard charts render', async () => {
      await expect(page.locator('[data-testid="revenue-chart"]')).toBeVisible();
      await expect(page.locator('[data-testid="bookings-chart"]')).toBeVisible();
    });

    test('Quick actions work', async () => {
      await page.click('[data-testid="quick-action-new-booking"]');
      await expect(page).toHaveURL(/\/bookings\/new/);
    });
  });

  // ===========================================
  // Booking Tests
  // ===========================================

  test.describe('Bookings', () => {
    test.beforeEach(async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.fill('[data-testid="email"]', 'admin@bouncervip.com');
      await page.fill('[data-testid="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.goto(`${BASE_URL}/bookings`);
    });

    test('Booking list loads', async () => {
      await expect(page.locator('[data-testid="booking-list"]')).toBeVisible();
    });

    test('Create new booking', async () => {
      await page.click('[data-testid="new-booking-button"]');
      
      await page.selectOption('[data-testid="venue-select"]', 'venue-1');
      await page.selectOption('[data-testid="service-type"]', 'standard');
      await page.fill('[data-testid="date"]', '2024-12-25');
      await page.fill('[data-testid="start-time"]', '18:00');
      await page.fill('[data-testid="end-time"]', '02:00');
      await page.fill('[data-testid="officer-count"]', '3');
      
      await page.click('[data-testid="submit-booking"]');
      
      await expect(page.locator('[data-testid="success-message"]')).toContainText('Booking created');
    });

    test('Filter bookings by status', async () => {
      await page.selectOption('[data-testid="status-filter"]', 'pending');
      await page.click('[data-testid="apply-filters"]');
      
      const bookingCards = await page.locator('[data-testid="booking-card"]').count();
      expect(bookingCards).toBeGreaterThan(0);
    });

    test('View booking details', async () => {
      await page.click('[data-testid="booking-card"] >> nth=0');
      await expect(page.locator('[data-testid="booking-details"]')).toBeVisible();
    });
  });

  // ===========================================
  // Officer Tests
  // ===========================================

  test.describe('Officers', () => {
    test.beforeEach(async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.fill('[data-testid="email"]', 'admin@bouncervip.com');
      await page.fill('[data-testid="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.goto(`${BASE_URL}/officers`);
    });

    test('Officer list loads', async () => {
      await expect(page.locator('[data-testid="officer-list"]')).toBeVisible();
    });

    test('Add new officer', async () => {
      await page.click('[data-testid="add-officer-button"]');
      
      await page.fill('[data-testid="first-name"]', 'John');
      await page.fill('[data-testid="last-name"]', 'Doe');
      await page.fill('[data-testid="email"]', 'john.doe@bouncervip.com');
      await page.fill('[data-testid="phone"]', '+27831234567');
      await page.selectOption('[data-testid="grade"]', 'C');
      
      await page.click('[data-testid="submit-officer"]');
      
      await expect(page.locator('[data-testid="success-message"]')).toContainText('Officer added');
    });

    test('Edit officer', async () => {
      await page.click('[data-testid="officer-row"] >> nth=0');
      await page.click('[data-testid="edit-button"]');
      
      await page.fill('[data-testid="phone"]', '+27839876543');
      await page.click('[data-testid="save-button"]');
      
      await expect(page.locator('[data-testid="success-message"]')).toContainText('Officer updated');
    });
  });

  // ===========================================
  // Venue Tests
  // ===========================================

  test.describe('Venues', () => {
    test.beforeEach(async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.fill('[data-testid="email"]', 'admin@bouncervip.com');
      await page.fill('[data-testid="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.goto(`${BASE_URL}/venues`);
    });

    test('Venue list loads', async () => {
      await expect(page.locator('[data-testid="venue-list"]')).toBeVisible();
    });

    test('Add new venue', async () => {
      await page.click('[data-testid="add-venue-button"]');
      
      await page.fill('[data-testid="venue-name"]', 'Test Venue');
      await page.fill('[data-testid="address"]', '123 Test Street');
      await page.fill('[data-testid="city"]', 'Johannesburg');
      await page.fill('[data-testid="province"]', 'Gauteng');
      await page.fill('[data-testid="capacity"]', '500');
      await page.selectOption('[data-testid="risk-level"]', 'medium');
      
      await page.click('[data-testid="submit-venue"]');
      
      await expect(page.locator('[data-testid="success-message"]')).toContainText('Venue added');
    });
  });

  // ===========================================
  // Invoice Tests
  // ===========================================

  test.describe('Invoices', () => {
    test.beforeEach(async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.fill('[data-testid="email"]', 'admin@bouncervip.com');
      await page.fill('[data-testid="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.goto(`${BASE_URL}/invoices`);
    });

    test('Invoice list loads', async () => {
      await expect(page.locator('[data-testid="invoice-list"]')).toBeVisible();
    });

    test('Create invoice', async () => {
      await page.click('[data-testid="create-invoice-button"]');
      
      await page.selectOption('[data-testid="client-select"]', 'client-1');
      await page.fill('[data-testid="line-description"]', 'Security Services');
      await page.fill('[data-testid="line-quantity"]', '10');
      await page.fill('[data-testid="line-rate"]', '150');
      
      await page.click('[data-testid="submit-invoice"]');
      
      await expect(page.locator('[data-testid="success-message"]')).toContainText('Invoice created');
    });

    test('Mark invoice as paid', async () => {
      await page.click('[data-testid="invoice-row"] >> nth=0');
      await page.click('[data-testid="mark-paid-button"]');
      
      await expect(page.locator('[data-testid="status-badge"]')).toContainText('Paid');
    });
  });

  // ===========================================
  // Incident Tests
  // ===========================================

  test.describe('Incidents', () => {
    test.beforeEach(async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.fill('[data-testid="email"]', 'admin@bouncervip.com');
      await page.fill('[data-testid="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"]');
      await page.goto(`${BASE_URL}/incidents`);
    });

    test('Incident list loads', async () => {
      await expect(page.locator('[data-testid="incident-list"]')).toBeVisible();
    });

    test('Report new incident', async () => {
      await page.click('[data-testid="report-incident-button"]');
      
      await page.fill('[data-testid="incident-title"]', 'Test Incident');
      await page.selectOption('[data-testid="incident-type"]', 'theft');
      await page.selectOption('[data-testid="severity"]', 'high');
      await page.fill('[data-testid="description"]', 'This is a test incident');
      
      await page.click('[data-testid="submit-incident"]');
      
      await expect(page.locator('[data-testid="success-message"]')).toContainText('Incident reported');
    });

    test('Resolve incident', async () => {
      await page.click('[data-testid="incident-row"] >> nth=0');
      await page.click('[data-testid="resolve-button"]');
      await page.fill('[data-testid="resolution-notes"]', 'Resolved');
      await page.click('[data-testid="confirm-resolve"]');
      
      await expect(page.locator('[data-testid="status-badge"]')).toContainText('Resolved');
    });
  });

  // ===========================================
  // Mobile App Tests
  // ===========================================

  test.describe('Mobile App', () => {
    test('Guard login screen loads', async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE_URL}/guard/login`);
      
      await expect(page.locator('[data-testid="app-logo"]')).toBeVisible();
      await expect(page.locator('[data-testid="email-input"]')).toBeVisible();
      await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    });

    test('Guard shift check-in', async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${BASE_URL}/guard/shifts`);
      await page.click('[data-testid="check-in-button"]');
      
      await expect(page.locator('[data-testid="check-in-success"]')).toBeVisible();
    });
  });

  // ===========================================
  // API Integration Tests
  // ===========================================

  test.describe('API Integration', () => {
    test('Health check endpoint', async () => {
      const response = await page.request.get(`${API_URL}/health`);
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.status).toBe('healthy');
    });

    test('Authentication API', async () => {
      const response = await page.request.post(`${API_URL}/auth/login`, {
        data: {
          email: 'admin@bouncervip.com',
          password: 'TestPassword123!',
        },
      });
      
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.token).toBeDefined();
    });

    test('Get bookings API', async () => {
      // Login first to get token
      const loginResponse = await page.request.post(`${API_URL}/auth/login`, {
        data: {
          email: 'admin@bouncervip.com',
          password: 'TestPassword123!',
        },
      });
      const { token } = await loginResponse.json();
      
      const bookingsResponse = await page.request.get(`${API_URL}/bookings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      expect(bookingsResponse.ok()).toBeTruthy();
    });
  });

  // ===========================================
  // Performance Tests
  // ===========================================

  test.describe('Performance', () => {
    test('Page load time', async () => {
      const startTime = Date.now();
      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');
      
      const loadTime = Date.now() - startTime;
      console.log(`Dashboard load time: ${loadTime}ms`);
      
      expect(loadTime).toBeLessThan(3000); // Should load under 3 seconds
    });

    test('No console errors on load', async () => {
      const consoleErrors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      
      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');
      
      // Filter out known false positives
      const criticalErrors = consoleErrors.filter(e => !e.includes('favicon'));
      expect(criticalErrors.length).toBe(0);
    });
  });

  // ===========================================
  // Accessibility Tests
  // ===========================================

  test.describe('Accessibility', () => {
    test('All inputs have labels', async () => {
      const inputs = await page.locator('input').all();
      
      for (const input of inputs) {
        const id = await input.getAttribute('id');
        const ariaLabel = await input.getAttribute('aria-label');
        const label = await page.locator(`label[for="${id}"]`).count();
        
        expect(ariaLabel || label).toBeTruthy();
      }
    });

    test('Focus indicators visible', async () => {
      await page.keyboard.press('Tab');
      const focusedElement = await page.locator(':focus').first();
      
      expect(await focusedElement.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.outline !== 'none' || style.boxShadow !== 'none';
      })).toBeTruthy();
    });
  });
});

// ===========================================
// Test Runners
// ===========================================

export default {
  timeout: 30000,
  retries: 2,
  workers: 4,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
};