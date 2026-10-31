#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <cstring>

const char* AP_SSID = "Totalplay-2.4G-9740_5G";
const char* AP_PASSWORD = "BUYZ8YdzcGbLCmEs";

IPAddress localIp(192, 168, 4, 1);
IPAddress gateway(192, 168, 4, 1);
IPAddress subnet(255, 255, 255, 0);

WebSocketsServer webSocket(81);

void onWebSocketEvent(uint8_t clientNumber, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      IPAddress clientIp = webSocket.remoteIP(clientNumber);
      Serial.printf("Cliente %u conectado desde %s\n", clientNumber, clientIp.toString().c_str());
      break;
    }

    case WStype_DISCONNECTED:
      Serial.printf("Cliente %u desconectado\n", clientNumber);
      break;

    case WStype_TEXT: {
      Serial.printf("RX [%u]: ", clientNumber);
      Serial.write(payload, length);
      Serial.println();

      JsonDocument message;
      DeserializationError error = deserializeJson(message, payload, length);
      if (error || message["t"] != "ping") {
        break;
      }

      unsigned long long timestamp = message["ts"] | 0ULL;
      char response[80];
      snprintf(response, sizeof(response), "{\"t\":\"pong\",\"ts\":%llu}", timestamp);
      webSocket.sendTXT(clientNumber, response);
      break;
    }

    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("Iniciando punto de acceso y servidor WebSocket...");

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(localIp, gateway, subnet);

  if (!WiFi.softAP(AP_SSID, AP_PASSWORD)) {
    Serial.println("ERROR: no se pudo iniciar el punto de acceso");
    return;
  }

  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);

  Serial.printf("WiFi: %s\n", AP_SSID);
  Serial.printf("Clave: %s\n", AP_PASSWORD);
  Serial.printf("WebSocket: ws://%s:81\n", WiFi.softAPIP().toString().c_str());
  Serial.println("Abre el monitor serie a 115200 baudios.");
}

void loop() {
  webSocket.loop();
}
