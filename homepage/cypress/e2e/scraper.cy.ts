const mockJobs = [
  {
    id: 'job-1',
    user_id: 'user-1',
    name: 'Concert Tickets',
    urls: ['https://example.com/events', 'https://example.com/tours'],
    instruction: 'Notify me if Tool or Puscifer tickets announced',
    schedule_cron: '0 */3 * * *',
    timezone: 'Australia/Sydney',
    enabled: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'job-2',
    user_id: 'user-1',
    name: 'Price Watch',
    urls: ['https://shop.example.com/item'],
    instruction: 'Alert if price drops below $50',
    schedule_cron: '0 9 * * *',
    timezone: 'Australia/Melbourne',
    enabled: false,
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
];

const mockRuns = [
  {
    id: 'run-1',
    job_id: 'job-1',
    status: 'success',
    urls_scraped: 2,
    notified: true,
    claude_response: 'No new ticket announcements found.',
    error: null,
    started_at: '2026-03-01T10:00:00Z',
    completed_at: '2026-03-01T10:01:00Z',
  },
  {
    id: 'run-2',
    job_id: 'job-1',
    status: 'failure',
    urls_scraped: 0,
    notified: false,
    claude_response: null,
    error: 'Connection timeout',
    started_at: '2026-03-01T07:00:00Z',
    completed_at: '2026-03-01T07:00:05Z',
  },
  {
    id: 'run-3',
    job_id: 'job-1',
    status: 'running',
    urls_scraped: 1,
    notified: false,
    claude_response: null,
    error: null,
    started_at: '2026-03-01T13:00:00Z',
    completed_at: null,
  },
];

function navigateToScraper() {
  cy.get('.menu-btn').click();
  cy.contains('.menu-item', 'Scraper').click();
  cy.get('.active-tab-label').should('contain', 'Scraper');
}

describe('Scraper Tab', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/tts/jobs', { body: [] });
    cy.intercept('GET', '/api/scraper/jobs', { body: { jobs: mockJobs } }).as('getJobs');
    cy.visit('/');
    cy.get('[data-hydrated]', { timeout: 10000 }).should('exist');
    navigateToScraper();
    cy.wait('@getJobs');
  });

  describe('Job List', () => {
    it('should display job cards', () => {
      cy.get('.job-card').should('have.length', 2);
      cy.get('.job-card').first().should('contain', 'Concert Tickets');
      cy.get('.job-card').last().should('contain', 'Price Watch');
    });

    it('should show URL count per job', () => {
      cy.get('.job-card').first().find('.job-meta').should('contain', '2 URLs');
      cy.get('.job-card').last().find('.job-meta').should('contain', '1 URL');
    });

    it('should show cron description and timezone', () => {
      cy.get('.job-card').first().find('.job-schedule').should('contain', 'Every 3 hour(s)');
      cy.get('.job-card').first().find('.job-schedule').should('contain', 'Australia/Sydney');
      cy.get('.job-card').last().find('.job-schedule').should('contain', 'Daily at 9:00');
    });

    it('should show instruction text', () => {
      cy.get('.job-card').first().find('.job-instruction').should('contain', 'Notify me if Tool or Puscifer');
    });

    it('should show enabled/disabled toggle state', () => {
      cy.get('.job-card').first().find('.toggle-btn').should('contain', 'ON').and('have.class', 'toggle-on');
      cy.get('.job-card').last().find('.toggle-btn').should('contain', 'OFF').and('have.class', 'toggle-off');
    });

    it('should show empty state when no jobs', () => {
      cy.intercept('GET', '/api/scraper/jobs', { body: { jobs: [] } }).as('emptyJobs');
      // Re-navigate to trigger refetch
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Weather').click();
      cy.intercept('GET', '/api/scraper/jobs', { body: { jobs: [] } }).as('emptyJobs2');
      navigateToScraper();
      cy.wait('@emptyJobs2');
      cy.get('.empty-state').should('contain', 'No scraper jobs yet');
    });

    it('should show error when jobs fail to load', () => {
      cy.intercept('GET', '/api/scraper/jobs', {
        statusCode: 500,
        body: { error: 'Database connection failed' },
      }).as('jobsError');
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Weather').click();
      navigateToScraper();
      cy.wait('@jobsError');
      cy.get('.error-result').should('contain', 'Database connection failed');
    });
  });

  describe('Toggle Enabled', () => {
    it('should toggle job enabled state', () => {
      cy.intercept('PUT', '/api/scraper/jobs/job-2', { statusCode: 200, body: {} }).as('toggleJob');
      const updatedJobs = mockJobs.map(j =>
        j.id === 'job-2' ? { ...j, enabled: true } : j
      );
      cy.intercept('GET', '/api/scraper/jobs', { body: { jobs: updatedJobs } }).as('refreshJobs');

      cy.get('.job-card').last().find('.toggle-btn').click();
      cy.wait('@toggleJob').its('request.body').should('deep.equal', { enabled: true });
      cy.wait('@refreshJobs');
      cy.get('.job-card').last().find('.toggle-btn').should('contain', 'ON');
    });
  });

  describe('Create Job', () => {
    it('should toggle create form on button click', () => {
      cy.get('.form-section').should('not.exist');
      cy.get('.create-btn').should('contain', '+ New Job').click();
      cy.get('.form-section').should('be.visible');
      cy.contains('h4', 'Create New Job').should('be.visible');
      cy.get('.create-btn').should('contain', 'Cancel').click();
      cy.get('.form-section').should('not.exist');
    });

    it('should disable submit when required fields are empty', () => {
      cy.get('.create-btn').click();
      cy.get('.submit-btn').should('be.disabled');
    });

    it('should enable submit when all required fields are filled', () => {
      cy.get('.create-btn').click();
      cy.get('.form-section').find('input[type="text"]').first().type('Test Job');
      cy.get('.form-section').find('textarea').first().type('https://example.com');
      cy.get('.form-section').find('textarea').last().type('Check for updates');
      cy.get('.submit-btn').should('not.be.disabled');
    });

    it('should show cron description hint', () => {
      cy.get('.create-btn').click();
      cy.get('.form-hint').should('contain', 'Every 3 hour(s)');
    });

    it('should show error when no URLs provided', () => {
      cy.get('.create-btn').click();
      cy.get('.form-section').find('input[type="text"]').first().type('Test Job');
      cy.get('.form-section').find('textarea').first().type('   ');
      cy.get('.form-section').find('textarea').last().type('Check for updates');
      // Force-click since the textarea with whitespace may not count as filled
      // The button is disabled by the bind:value check, so we need non-empty createUrls
      // Actually whitespace will make createUrls truthy, so the button is enabled
      cy.get('.submit-btn').click();
      cy.get('.error-result').should('contain', 'At least one URL is required');
    });

    it('should create job and reset form on success', () => {
      cy.intercept('POST', '/api/scraper/jobs', {
        statusCode: 200,
        body: { job: { id: 'job-new', name: 'New Job' } },
      }).as('createJob');

      const withNewJob = [...mockJobs, {
        id: 'job-new',
        user_id: 'user-1',
        name: 'New Job',
        urls: ['https://test.com'],
        instruction: 'Watch for changes',
        schedule_cron: '0 */3 * * *',
        timezone: 'Australia/Sydney',
        enabled: true,
        created_at: '2026-03-07T00:00:00Z',
        updated_at: '2026-03-07T00:00:00Z',
      }];
      cy.intercept('GET', '/api/scraper/jobs', { body: { jobs: withNewJob } }).as('refreshAfterCreate');

      cy.get('.create-btn').click();
      cy.get('.form-section').find('input[type="text"]').first().type('New Job');
      cy.get('.form-section').find('textarea').first().type('https://test.com');
      cy.get('.form-section').find('textarea').last().type('Watch for changes');
      cy.get('.submit-btn').click();

      cy.wait('@createJob').its('request.body').should('deep.include', {
        name: 'New Job',
        urls: ['https://test.com'],
        instruction: 'Watch for changes',
      });

      cy.wait('@refreshAfterCreate');
      cy.get('.form-section').should('not.exist');
      cy.get('.job-card').should('have.length', 3);
    });

    it('should show error on create failure', () => {
      cy.intercept('POST', '/api/scraper/jobs', {
        statusCode: 400,
        body: { error: 'Invalid cron expression' },
      }).as('createFail');

      cy.get('.create-btn').click();
      cy.get('.form-section').find('input[type="text"]').first().type('Bad Job');
      cy.get('.form-section').find('textarea').first().type('https://test.com');
      cy.get('.form-section').find('textarea').last().type('Do something');
      cy.get('.submit-btn').click();

      cy.wait('@createFail');
      cy.get('.error-result').should('contain', 'Invalid cron expression');
    });

    it('should show loading state during create', () => {
      cy.intercept('POST', '/api/scraper/jobs', {
        statusCode: 200,
        body: { job: { id: 'job-new' } },
        delay: 1000,
      }).as('createSlow');

      cy.get('.create-btn').click();
      cy.get('.form-section').find('input[type="text"]').first().type('Slow Job');
      cy.get('.form-section').find('textarea').first().type('https://test.com');
      cy.get('.form-section').find('textarea').last().type('Instruction');
      cy.get('.submit-btn').click();

      cy.get('.submit-btn').should('be.disabled');
      cy.get('.submit-btn').should('contain', 'Creating...');
    });

    it('should parse comma-separated URLs', () => {
      cy.intercept('POST', '/api/scraper/jobs', {
        statusCode: 200,
        body: { job: { id: 'job-new' } },
      }).as('createMultiUrl');
      cy.intercept('GET', '/api/scraper/jobs', { body: { jobs: mockJobs } });

      cy.get('.create-btn').click();
      cy.get('.form-section').find('input[type="text"]').first().type('Multi URL');
      cy.get('.form-section').find('textarea').first().type('https://a.com, https://b.com, https://c.com');
      cy.get('.form-section').find('textarea').last().type('Check all');
      cy.get('.submit-btn').click();

      cy.wait('@createMultiUrl').its('request.body.urls').should('deep.equal', [
        'https://a.com',
        'https://b.com',
        'https://c.com',
      ]);
    });
  });

  describe('Edit Job', () => {
    it('should open edit form with pre-filled values', () => {
      cy.get('.job-card').first().find('.edit-btn').click();
      cy.contains('h4', 'Edit: Concert Tickets').should('be.visible');
      cy.get('.form-section').find('input[type="text"]').first().should('have.value', 'Concert Tickets');
      cy.get('.form-section').find('textarea').first().should('contain.value', 'https://example.com/events');
      cy.get('.form-section').find('textarea').last().should('have.value', 'Notify me if Tool or Puscifer tickets announced');
    });

    it('should cancel edit', () => {
      cy.get('.job-card').first().find('.edit-btn').click();
      cy.get('.form-section').should('be.visible');
      cy.get('.cancel-btn').click();
      cy.get('.form-section').should('not.exist');
    });

    it('should save edit and refresh jobs', () => {
      cy.intercept('PUT', '/api/scraper/jobs/job-1', {
        statusCode: 200,
        body: { job: { id: 'job-1' } },
      }).as('saveEdit');
      cy.intercept('GET', '/api/scraper/jobs', { body: { jobs: mockJobs } }).as('refreshAfterEdit');

      cy.get('.job-card').first().find('.edit-btn').click();
      cy.get('.form-section').find('input[type="text"]').first().clear().type('Updated Name');
      cy.contains('Save Changes').click();

      cy.wait('@saveEdit').its('request.body').should('include', { name: 'Updated Name' });
      cy.wait('@refreshAfterEdit');
      cy.get('.form-section').should('not.exist');
    });

    it('should show error on edit failure', () => {
      cy.intercept('PUT', '/api/scraper/jobs/job-1', {
        statusCode: 500,
        body: { error: 'Server error' },
      }).as('editFail');

      cy.get('.job-card').first().find('.edit-btn').click();
      cy.contains('Save Changes').click();

      cy.wait('@editFail');
      cy.get('.error-result').should('contain', 'Server error');
    });
  });

  describe('Delete Job', () => {
    it('should delete job after confirmation', () => {
      cy.intercept('DELETE', '/api/scraper/jobs/job-1', { statusCode: 200, body: {} }).as('deleteJob');
      const remaining = mockJobs.filter(j => j.id !== 'job-1');
      cy.intercept('GET', '/api/scraper/jobs', { body: { jobs: remaining } }).as('refreshAfterDelete');

      cy.window().then(win => cy.stub(win, 'confirm').returns(true));
      cy.get('.job-card').first().find('.delete-btn').click();

      cy.wait('@deleteJob');
      cy.wait('@refreshAfterDelete');
      cy.get('.job-card').should('have.length', 1);
      cy.get('.job-card').first().should('contain', 'Price Watch');
    });

    it('should not delete when confirmation is cancelled', () => {
      cy.window().then(win => cy.stub(win, 'confirm').returns(false));
      cy.get('.job-card').first().find('.delete-btn').click();
      cy.get('.job-card').should('have.length', 2);
    });
  });

  describe('Trigger Job', () => {
    it('should trigger job and show workflow ID', () => {
      cy.intercept('POST', '/api/scraper/jobs/job-1/trigger', {
        statusCode: 200,
        body: { workflow_id: 'wf-abc123' },
      }).as('triggerJob');

      cy.get('.job-card').first().find('.trigger-btn').click();
      cy.wait('@triggerJob');
      cy.get('.job-card').first().find('.success-result').should('contain', 'Started: wf-abc123');
    });

    it('should show error on trigger failure', () => {
      cy.intercept('POST', '/api/scraper/jobs/job-1/trigger', {
        statusCode: 500,
        body: { error: 'Workflow engine unavailable' },
      }).as('triggerFail');

      cy.get('.job-card').first().find('.trigger-btn').click();
      cy.wait('@triggerFail');
      cy.get('.job-card').first().find('.success-result').should('contain', 'Error: Workflow engine unavailable');
    });

    it('should disable trigger button while loading', () => {
      cy.intercept('POST', '/api/scraper/jobs/job-1/trigger', {
        statusCode: 200,
        body: { workflow_id: 'wf-123' },
        delay: 1000,
      }).as('triggerSlow');

      cy.get('.job-card').first().find('.trigger-btn').click();
      cy.get('.job-card').first().find('.trigger-btn').should('be.disabled');
    });
  });

  describe('Run History', () => {
    it('should expand and show run history', () => {
      cy.intercept('GET', '/api/scraper/jobs/job-1/runs?limit=10', {
        body: { runs: mockRuns },
      }).as('getRuns');

      cy.get('.job-card').first().find('.history-btn').should('contain', 'History').click();
      cy.wait('@getRuns');

      cy.get('.runs-table').should('be.visible');
      cy.get('.runs-table tbody tr').should('have.length', 3);
    });

    it('should display run status badges', () => {
      cy.intercept('GET', '/api/scraper/jobs/job-1/runs?limit=10', {
        body: { runs: mockRuns },
      }).as('getRuns');

      cy.get('.job-card').first().find('.history-btn').click();
      cy.wait('@getRuns');

      cy.get('.status-badge.status-success').should('contain', 'success');
      cy.get('.status-badge.status-failure').should('contain', 'failure');
      cy.get('.status-badge.status-running').should('contain', 'running');
    });

    it('should show run details (URLs scraped, notified, response/error)', () => {
      cy.intercept('GET', '/api/scraper/jobs/job-1/runs?limit=10', {
        body: { runs: mockRuns },
      }).as('getRuns');

      cy.get('.job-card').first().find('.history-btn').click();
      cy.wait('@getRuns');

      // First run: success with response
      cy.get('.runs-table tbody tr').eq(0).within(() => {
        cy.get('td').eq(1).should('contain', '2');
        cy.get('td').eq(2).should('contain', 'Yes');
        cy.get('.run-response').should('contain', 'No new ticket announcements');
      });

      // Second run: failure with error
      cy.get('.runs-table tbody tr').eq(1).within(() => {
        cy.get('td').eq(1).should('contain', '0');
        cy.get('td').eq(2).should('contain', 'No');
        cy.get('.run-response').should('contain', 'Connection timeout');
      });
    });

    it('should collapse history on second click', () => {
      cy.intercept('GET', '/api/scraper/jobs/job-1/runs?limit=10', {
        body: { runs: mockRuns },
      }).as('getRuns');

      cy.get('.job-card').first().find('.history-btn').click();
      cy.wait('@getRuns');
      cy.get('.runs-table').should('be.visible');
      cy.get('.job-card').first().find('.history-btn').should('contain', 'Hide History').click();
      cy.get('.runs-table').should('not.exist');
    });

    it('should show empty state when no runs', () => {
      cy.intercept('GET', '/api/scraper/jobs/job-1/runs?limit=10', {
        body: { runs: [] },
      }).as('emptyRuns');

      cy.get('.job-card').first().find('.history-btn').click();
      cy.wait('@emptyRuns');
      cy.get('.runs-section .empty-state').should('contain', 'No runs yet');
    });

    it('should show loading state while fetching runs', () => {
      cy.intercept('GET', '/api/scraper/jobs/job-1/runs?limit=10', {
        body: { runs: mockRuns },
        delay: 1000,
      }).as('slowRuns');

      cy.get('.job-card').first().find('.history-btn').click();
      cy.get('.runs-section .loading-indicator').should('be.visible');
    });
  });
});
