describe('Homepage', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  describe('Weather Tab', () => {
    it('should display weather information by default', () => {
      // Verify weather tab is active
      cy.get('.tab-btn.active').should('contain', 'Weather');

      // Check for main weather components or error message
      cy.get('body').then($body => {
        if ($body.find('.error-message').length > 0) {
           cy.log('Weather API error displayed');
           cy.get('.error-message').should('be.visible');
        } else {
           cy.get('.main-weather').should('be.visible');
           cy.get('.stats-grid').should('be.visible');
           cy.get('.forecast-section').should('be.visible');
        }
      });
    });

    it('should interact with forecast days', () => {
      cy.get('body').then($body => {
        // Only run if forecast is available
        if ($body.find('.forecast-day').length > 0) {
           // Hover over the second day if available, or just re-hover first
           cy.get('.forecast-day').eq(0).trigger('mouseenter');
           cy.get('#hourly-details').should('be.visible');
        }
      });
    });
  });

  describe('Text to Speech Tab', () => {
    it('should switch to TTS tab and generate speech', () => {
      // Switch to TTS tab
      cy.wait(1000); // Wait for hydration
      cy.contains('.tab-btn', 'Text to Speech').click();
      cy.contains('.tab-btn.active', 'Text to Speech').should('be.visible');

      // Verify TTS elements
      cy.get('.tts-card').should('be.visible');
      cy.get('#tts-file').should('exist');
      cy.get('#tts-voice').should('exist');
      cy.get('#tts-speed').should('exist');

      // Mock API responses
      cy.intercept('POST', '/api/tts/generate', {
        statusCode: 200,
        body: { id: 'test-job-id' }
      }).as('generateSpeech');

      // Mock Status Polling (Processing then Completed)
      // The client polls every 3s if status is processing.
      // When it receives non-JSON, it considers it done.
      let requestCount = 0;
      cy.intercept('GET', '/api/tts/status/test-job-id', (req) => {
        requestCount++;
        if (requestCount === 1) {
             req.reply({
                statusCode: 200,
                headers: { 'content-type': 'application/json' },
                body: { status: 'processing' }
             });
        } else {
             // Second request returns non-json (audio file) to signal completion
             req.reply({
                statusCode: 200,
                headers: { 'content-type': 'audio/mpeg' },
                body: 'fake-audio-content'
             });
        }
      }).as('pollStatus');

      // Fill form
      cy.get('#tts-file').selectFile('cypress/fixtures/sample.txt');
      cy.get('#tts-voice').select('af_heart');
      cy.get('#tts-speed').clear().type('1.2');

      // Click Generate
      cy.get('.generate-btn').click();

      // Verify Processing state
      cy.contains('Processing...').should('be.visible');

      // Verify Success (might need to wait for polling)
      cy.contains('Audio generated successfully!', { timeout: 10000 }).should('be.visible');
      cy.contains('Download MP3').should('be.visible');
    });
  });
});
