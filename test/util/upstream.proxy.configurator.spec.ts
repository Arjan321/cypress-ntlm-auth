// cSpell:ignore nisse, mnpwr, mptest
import "reflect-metadata";
import "mocha";
import { Substitute, SubstituteOf, Arg } from "@fluffy-spoon/substitute";

import { expect } from "chai";

import { IDebugLogger } from "../../src/util/interfaces/i.debug.logger";
import { DebugLogger } from "../../src/util/debug.logger";
import { UpstreamProxyConfigurator } from "../../src/util/upstream.proxy.configurator";

describe("UpstreamProxyConfigurator", () => {
  let upstreamProxyConfigurator: UpstreamProxyConfigurator;
  let debugMock: SubstituteOf<IDebugLogger>;
  let debugLogger = new DebugLogger();

  beforeEach(function() {
    debugMock = Substitute.for<IDebugLogger>();
    debugMock.log(Arg.all()).mimicks(debugLogger.log);
    upstreamProxyConfigurator = new UpstreamProxyConfigurator(debugMock);
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NO_PROXY;
  });

  after(function() {
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.NO_PROXY;
  });

  it("should not modify NO_PROXY when neither HTTP_PROXY or HTTPS_PROXY are set", function() {
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.be.undefined;
  });

  it("should modify NO_PROXY when HTTP_PROXY is set", function() {
    process.env.HTTP_PROXY = "test";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).not.to.be.undefined;
  });

  it("should modify NO_PROXY when HTTPS_PROXY is set", function() {
    process.env.HTTPS_PROXY = "test";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).not.to.be.undefined;
  });

  it("should add both localhost and 127.0.0.1 to NO_PROXY", function() {
    process.env.HTTP_PROXY = "test";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal("localhost,127.0.0.1");
  });

  it("should not add localhost to NO_PROXY if already present variant 1", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = "localhost";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal("localhost,127.0.0.1");
  });

  it("should not add localhost to NO_PROXY if already present variant 2", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = " localhost ";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal("localhost,127.0.0.1");
  });

  it("should not add localhost to NO_PROXY if already present variant 3", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = "google.com, localhost , ello.com";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal(
      "google.com,localhost,ello.com,127.0.0.1"
    );
  });

  it("should not add localhost to NO_PROXY if already present variant 4", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = "google.com,localhost,ello.com";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal(
      "google.com,localhost,ello.com,127.0.0.1"
    );
  });

  it("should not add 127.0.0.1 to NO_PROXY if already present variant 1", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = "127.0.0.1";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal("127.0.0.1,localhost");
  });

  it("should not add 127.0.0.1 to NO_PROXY if already present variant 2", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = " 127.0.0.1 ";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal("127.0.0.1,localhost");
  });

  it("should not add 127.0.0.1 to NO_PROXY if already present variant 3", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = "google.com, 127.0.0.1 , ello.com";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal(
      "google.com,127.0.0.1,ello.com,localhost"
    );
  });

  it("should not add 127.0.0.1 to NO_PROXY if already present variant 4", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = "google.com,127.0.0.1,ello.com";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal(
      "google.com,127.0.0.1,ello.com,localhost"
    );
  });

  it("should not add anything if both are present", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = "127.0.0.1, localhost, google.com";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal("127.0.0.1,localhost,google.com");
  });

  it("should not add anything if <-loopback> is present", function() {
    process.env.HTTP_PROXY = "test";
    process.env.NO_PROXY = "ello.com, <-loopback>";
    upstreamProxyConfigurator.processNoProxyLoopback();
    expect(process.env.NO_PROXY).to.equal("ello.com, <-loopback>");
  });
});
