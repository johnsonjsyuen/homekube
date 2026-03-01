describe('Homepage', () => {
  beforeEach(() => {
    // Intercept TTS jobs API to prevent errors from missing backend
    cy.intercept('GET', '/api/tts/jobs', { body: [] });
    cy.visit('/');
    // Wait for SvelteKit hydration so event handlers are attached
    cy.get('[data-hydrated]', { timeout: 10000 }).should('exist');
  });

  describe('Hamburger Menu', () => {
    it('should always be visible', () => {
      cy.get('.menu-btn').should('be.visible');
    });

    it('should open and show menu items on click', () => {
      cy.get('.menu-dropdown').should('not.exist');
      cy.get('.menu-btn').click();
      cy.get('.menu-dropdown').should('be.visible');
      // Weather tab should always be in menu
      cy.contains('.menu-item', 'Weather').should('be.visible');
    });

    it('should show auth section in menu', () => {
      cy.get('.menu-btn').click();
      // Cypress mock auth sets authenticated=true, so we should see username and logout
      cy.get('.menu-auth').should('be.visible');
      cy.get('.menu-username').should('contain', 'test_user');
      cy.get('.menu-logout-btn').should('be.visible');
    });

    it('should show authenticated tabs when logged in', () => {
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Text to Speech').should('be.visible');
      cy.contains('.menu-item', 'Speech to Text').should('be.visible');
      cy.contains('.menu-item', 'Live TTS').should('be.visible');
      cy.contains('.menu-item', 'WhatsApp').should('be.visible');
      cy.contains('.menu-item', 'Workflows').should('be.visible');
      cy.contains('.menu-item', 'Scraper').should('be.visible');
    });

    it('should close menu on backdrop click', () => {
      cy.get('.menu-btn').click();
      cy.get('.menu-dropdown').should('be.visible');
      cy.get('.menu-backdrop').click({ force: true });
      cy.get('.menu-dropdown').should('not.exist');
    });

    it('should close menu on Escape key', () => {
      cy.get('.menu-btn').click();
      cy.get('.menu-dropdown').should('be.visible');
      cy.get('body').type('{esc}');
      cy.get('.menu-dropdown').should('not.exist');
    });

    it('should highlight active tab in menu', () => {
      cy.get('.menu-btn').click();
      cy.contains('.menu-item.active', 'Weather').should('exist');
    });

    it('should update active tab label when switching tabs', () => {
      cy.get('.active-tab-label').should('contain', 'Weather');
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Text to Speech').click();
      cy.get('.active-tab-label').should('contain', 'Text to Speech');
    });

    it('should close menu after selecting a tab', () => {
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Text to Speech').click();
      cy.get('.menu-dropdown').should('not.exist');
    });
  });

  describe('Header Layout', () => {
    it('should show location selector only on weather tab', () => {
      cy.get('.location-select').should('be.visible');
      // Switch to another tab
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Text to Speech').click();
      cy.get('.location-select').should('not.exist');
    });

    it('should always show datetime', () => {
      cy.get('.datetime').should('be.visible');
    });

    it('should show fetched-at timestamp', () => {
      cy.get('.fetched-at').should('be.visible');
      cy.get('.fetched-at').should('contain', 'Last updated');
    });
  });

  describe('Location Selector', () => {
    it('should change location to Sydney', () => {
      cy.get('.location-select').select('sydney');
      // SvelteKit goto() only updates URL after the server-side load function
      // resolves, which fetches weather data from external APIs (can be slow in CI)
      cy.url({ timeout: 30000 }).should('include', 'location=sydney');
      cy.get('.location').should('contain', 'Sydney');
    });

    it('should change location to Hong Kong', () => {
      cy.get('.location-select').select('hong_kong');
      cy.url({ timeout: 30000 }).should('include', 'location=hong_kong');
      cy.get('.location').should('contain', 'Hong Kong');
    });

    it('should request geolocation when "Current Location" selected', () => {
      cy.window().then((win) => {
        cy.stub(win.navigator.geolocation, 'getCurrentPosition').callsFake((success) => {
          success({
            coords: {
              latitude: -37.8136,
              longitude: 144.9631
            }
          });
        });
      });

      cy.get('.location-select').select('current_location');
      cy.url({ timeout: 30000 }).should('include', 'lat=');
      cy.url().should('include', 'lon=');
    });

    it('should handle geolocation permission denied', () => {
      cy.window().then((win) => {
        cy.stub(win.navigator.geolocation, 'getCurrentPosition').callsFake((success, error) => {
          error({ code: 1, message: 'User denied Geolocation' });
        });
        cy.stub(win, 'alert');
      });

      cy.get('.location-select').select('current_location');
      cy.window().its('alert').should('be.called');
      // Should revert to previous location
      cy.get('.location-select').should('have.value', 'port_melbourne');
    });
  });

  describe('Weather Tab', () => {
    it('should display weather information by default', () => {
      // Verify weather tab is active via the header label
      cy.get('.active-tab-label').should('contain', 'Weather');

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

    it('should display all weather stat cards', () => {
      cy.get('body').then($body => {
        if ($body.find('.error-message').length > 0) return;

        // Wind speed
        cy.get('.stat-card').contains('Wind Speed').should('be.visible');
        cy.get('.stat-card').contains('kn').should('exist');
        // Wind direction
        cy.get('.stat-card').contains('Wind Direction').should('be.visible');
        // Humidity
        cy.get('.stat-card').contains('Humidity').should('be.visible');
        // Cloud cover
        cy.get('.stat-card').contains('Cloud Cover').should('be.visible');
      });
    });

    it('should display temperature and condition', () => {
      cy.get('body').then($body => {
        if ($body.find('.error-message').length > 0) return;

        cy.get('.temperature').should('be.visible');
        cy.get('.temperature').should('contain', '°C');
        cy.get('.condition').should('be.visible');
        cy.get('.weather-icon').should('be.visible');
      });
    });

    it('should display 7-day forecast with temps and wind', () => {
      cy.get('body').then($body => {
        if ($body.find('.error-message').length > 0) return;

        cy.get('.forecast-title').should('contain', '7-Day Forecast');
        cy.get('.forecast-day').should('have.length.gte', 2);
        // First day should be Today
        cy.get('.forecast-day').first().find('.forecast-day-name').should('contain', 'Today');
        // Each day should have temps and wind
        cy.get('.forecast-day').first().find('.forecast-high').should('exist');
        cy.get('.forecast-day').first().find('.forecast-low').should('exist');
        cy.get('.forecast-day').first().find('.forecast-wind').should('exist');
      });
    });

    it('should show Today as active forecast day by default', () => {
      cy.get('body').then($body => {
        if ($body.find('.forecast-day').length === 0) return;

        cy.get('.forecast-day.active').should('exist');
        cy.get('.forecast-day.active .forecast-day-name').should('contain', 'Today');
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

    it('should change hourly data when hovering different forecast days', () => {
      cy.get('body').then($body => {
        if ($body.find('.forecast-day').length < 2) return;

        // Hover Today - title should say Today
        cy.get('.forecast-day').eq(0).trigger('mouseenter');
        cy.get('#hourly-date-title').should('contain', "Today's Wind Forecast");

        // Hover second day - title should change and active class should move
        cy.get('.forecast-day').eq(1).trigger('mouseenter');
        cy.get('.forecast-day').eq(1).should('have.class', 'active');
        cy.get('.forecast-day').eq(0).should('not.have.class', 'active');
        cy.get('#hourly-date-title').should('not.contain', "Today's Wind Forecast");
      });
    });
  });

  describe('Wind Forecast Autoscroll', () => {
    it('should render hourly wind cards in scroll container', () => {
      cy.get('body').then($body => {
        if ($body.find('#hourly-container').length === 0) return;

        cy.get('#hourly-container').should('be.visible');
        cy.get('#hourly-container .hourly-card').should('have.length.gte', 2);
      });
    });

    it('should display wind speed and direction in hourly cards', () => {
      cy.get('body').then($body => {
        if ($body.find('.hourly-card').length === 0) return;

        cy.get('.hourly-card').first().within(() => {
          cy.get('.hourly-time').should('exist');
          cy.get('.hourly-wind').should('exist');
          cy.get('.hourly-dir').should('exist');
        });
      });
    });

    it('should auto-scroll to current hour when viewing Today', () => {
      cy.get('body').then($body => {
        if ($body.find('#hourly-container').length === 0) return;

        // Ensure we're viewing Today
        cy.get('.forecast-day').eq(0).trigger('mouseenter');
        cy.get('#hourly-date-title').should('contain', "Today's Wind Forecast");

        // The scroll container should have scrolled (scrollLeft > 0)
        // unless it's very early morning
        cy.get('#hourly-container').then($container => {
          const currentHour = new Date().getHours();
          if (currentHour > 2) {
            // After the first couple hours, scroll should not be at start
            expect($container[0].scrollLeft).to.be.greaterThan(0);
          }
        });
      });
    });

    it('should reset scroll position when switching to non-Today forecast day', () => {
      cy.get('body').then($body => {
        if ($body.find('.forecast-day').length < 2) return;

        // First view Today (may auto-scroll)
        cy.get('.forecast-day').eq(0).trigger('mouseenter');
        // eslint-disable-next-line cypress/no-unnecessary-waiting
        cy.wait(200); // let autoscroll settle

        // Switch to second day
        cy.get('.forecast-day').eq(1).trigger('mouseenter');
        // eslint-disable-next-line cypress/no-unnecessary-waiting
        cy.wait(200); // let scroll reset

        cy.get('#hourly-container').then($container => {
          expect($container[0].scrollLeft).to.equal(0);
        });
      });
    });

    it('should have a horizontally scrollable container', () => {
      cy.get('body').then($body => {
        if ($body.find('#hourly-container').length === 0) return;

        cy.get('#hourly-container').then($container => {
          // Container should have scrollable overflow (content wider than visible area)
          expect($container[0].scrollWidth).to.be.greaterThan($container[0].clientWidth);
        });
      });
    });
  });

  describe('Tab Navigation', () => {
    it('should navigate to each tab and back to weather', () => {
      const tabs = ['Text to Speech', 'Speech to Text', 'Live TTS', 'WhatsApp', 'Workflows', 'Scraper'];

      tabs.forEach(tab => {
        cy.get('.menu-btn').click();
        cy.contains('.menu-item', tab).click();
        cy.get('.active-tab-label').should('contain', tab);
      });

      // Navigate back to Weather
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Weather').click();
      cy.get('.active-tab-label').should('contain', 'Weather');
      // Weather content should reappear
      cy.get('.main-weather').should('be.visible');
    });

    it('should update URL query parameter when switching tabs', () => {
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Text to Speech').click();
      cy.url().should('include', 'tab=tts');

      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Weather').click();
      cy.url().should('include', 'tab=weather');
    });

    it('should hide weather content when on another tab', () => {
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Text to Speech').click();
      cy.get('.main-weather').should('not.exist');
      cy.get('.stats-grid').should('not.exist');
    });
  });

  describe('Text to Speech Tab', () => {
    beforeEach(() => {
      // Open hamburger menu and select TTS tab
      cy.get('.menu-btn').click();
      cy.contains('.menu-item', 'Text to Speech').click();
      cy.get('.active-tab-label').should('contain', 'Text to Speech');
    });

    it('should show alert when generating without file', () => {
      cy.window().then((win) => {
        cy.stub(win, 'alert').as('alertStub');
      });

      cy.get('.generate-btn').click();
      cy.get('@alertStub').should('be.calledWith', 'Please select a text file.');
    });

    it('should handle API error response', () => {
      cy.intercept('POST', '/api/tts/generate', {
        statusCode: 500,
        body: 'Internal server error'
      }).as('generateError');

      cy.get('#tts-file').selectFile('cypress/fixtures/sample.txt');
      cy.get('.generate-btn').click();

      cy.wait('@generateError');
      cy.get('.error-msg').should('be.visible');
      cy.get('.error-msg').should('contain', 'Internal server error');
    });

    it('should handle status polling error', () => {
      cy.intercept('POST', '/api/tts/generate', {
        statusCode: 200,
        body: { id: 'test-job-id' }
      }).as('generateSpeech');

      cy.intercept('GET', '/api/tts/status/test-job-id', {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: { status: 'error', message: 'TTS processing failed' }
      }).as('pollError');

      cy.get('#tts-file').selectFile('cypress/fixtures/sample.txt');
      cy.get('.generate-btn').click();

      cy.wait('@pollError');
      cy.get('.error-msg').should('be.visible');
      cy.get('.error-msg').should('contain', 'TTS processing failed');
    });

    it('should disable button during processing', () => {
      cy.intercept('POST', '/api/tts/generate', {
        statusCode: 200,
        body: { id: 'test-job-id' },
        delay: 1000
      }).as('generateSpeech');

      cy.intercept('GET', '/api/tts/status/test-job-id', {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: { status: 'processing' }
      }).as('pollStatus');

      cy.get('#tts-file').selectFile('cypress/fixtures/sample.txt');
      cy.get('.generate-btn').click();

      cy.get('.generate-btn').should('be.disabled');
      cy.get('.generate-btn').should('contain', 'Processing...');
    });

    it('should switch to TTS tab and generate speech', () => {
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
