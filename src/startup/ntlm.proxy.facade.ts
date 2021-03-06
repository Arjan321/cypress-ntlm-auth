import { TYPES } from "../proxy/dependency.injection.types";
import { inject, injectable } from "inversify";
import { IDebugLogger } from "../util/interfaces/i.debug.logger";
import http from "http";
import url from "url";
import { INtlmProxyFacade } from "./interfaces/i.ntlm.proxy.facade";
import { PortsConfig } from "../models/ports.config.model";
import { NtlmConfig } from "../models/ntlm.config.model";
import { NtlmSsoConfig } from "../models/ntlm.sso.config.model";

@injectable()
export class NtlmProxyFacade implements INtlmProxyFacade {
  private _debug: IDebugLogger;

  constructor(@inject(TYPES.IDebugLogger) debug: IDebugLogger) {
    this._debug = debug;
  }

  private async request(
    configApiUrl: string,
    path: string,
    method: string,
    body: any
  ) {
    return new Promise((resolve, reject) => {
      this._debug.log(
        "Sending " + path + " request to NTLM proxy " + configApiUrl
      );
      const configApiUrlParsed = url.parse(configApiUrl);
      const options: http.RequestOptions = {
        hostname: configApiUrlParsed.hostname,
        port: configApiUrlParsed.port,
        path: "/" + path,
        method: method,
        timeout: 3000,
      };
      const req = http.request(options, (res) => {
        let resBody = "";
        res.on("data", (chunk) => (resBody += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            this._debug.log(
              "Unexpected response from NTLM proxy: " + res.statusCode
            );
            this._debug.log("Response body: " + resBody);
            this._debug.log(path + " request failed");
            return reject(
              "Unexpected response from NTLM proxy: " + res.statusCode
            );
          }

          this._debug.log(path + " request succeeded");
          if (!resBody || resBody === "OK") {
            return resolve();
          } else {
            this._debug.log(path + " response body " + resBody);
            return resolve(JSON.parse(resBody));
          }
        });
      });

      req.on("error", (error) => {
        this._debug.log(path + " request failed");
        return reject(
          "An error occurred while communicating with NTLM proxy: " +
            error.message
        );
      });

      if (body) {
        const bodyStr = JSON.stringify(body);
        req.setHeader("Content-Type", "application/json");
        req.setHeader("Content-Length", bodyStr.length);
        req.write(bodyStr);
      }
      req.end();
    });
  }

  async alive(configApiUrl: string): Promise<PortsConfig> {
    return (await this.request(
      configApiUrl,
      "alive",
      "GET",
      undefined
    )) as PortsConfig;
  }

  async reset(configApiUrl: string) {
    await this.request(configApiUrl, "reset", "POST", undefined);
  }

  async ntlm(configApiUrl: string, ntlmConfig: NtlmConfig) {
    await this.request(configApiUrl, "ntlm-config", "POST", ntlmConfig);
  }

  async ntlmSso(configApiUrl: string, ntlmSsoConfig: NtlmSsoConfig) {
    await this.request(configApiUrl, "ntlm-sso", "POST", ntlmSsoConfig);
  }

  async quitIfRunning(configApiUrl?: string): Promise<boolean> {
    if (configApiUrl) {
      (await this.request(
        configApiUrl,
        "quit",
        "POST",
        undefined
      )) as PortsConfig;
      return true;
    } else {
      this._debug.log("CYPRESS_NTLM_AUTH_API is not set, nothing to do.");
      return false;
    }
  }
}
