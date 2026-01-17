import http.server
import socketserver
import json
import datetime
import urllib.request
import urllib.error
import time

PORT = 5000

class WeatherHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Set headers
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()

        # Get Weather
        # Melbourne: Lat -37.81, Long 144.96
        weather_url = "https://api.open-meteo.com/v1/forecast?latitude=-37.81&longitude=144.96&current_weather=true"
        temperature = "Unknown"
        
        try:
            # Set a short timeout for network call
            with urllib.request.urlopen(weather_url, timeout=2) as response:
                data = json.loads(response.read().decode())
                temperature = data.get('current_weather', {}).get('temperature', 'Unknown')
        except Exception as e:
            temperature = f"Unavailable (Network Error: {str(e)})"

        # Get Local Time for Melbourne (UTC+10 or UTC+11)
        # We manually offset since we can't use pytz and system might be UTC
        # Assuming UTC+11 for now (Jan)
        utc_now = datetime.datetime.utcnow()
        melbourne_time = utc_now + datetime.timedelta(hours=11)
        local_time_str = melbourne_time.strftime('%Y-%m-%d %H:%M:%S')

        response_data = {
            "location": "Melbourne",
            "temperature_celsius": temperature,
            "local_time": local_time_str,
            "source": "Standard Lib Python Service"
        }

        self.wfile.write(json.dumps(response_data).encode())

print(f"Starting server on port {PORT}")
with socketserver.TCPServer(("", PORT), WeatherHandler) as httpd:
    httpd.serve_forever()
