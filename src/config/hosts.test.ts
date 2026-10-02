import { describe, expect, it } from "vitest";
import { parse } from "ssh-config";
import { listHostAliases } from "./hosts.js";

describe("listHostAliases", () => {
  it("returns concrete aliases, skipping wildcards, negations and duplicates", () => {
    const config = parse(`
Host *
    AddKeysToAgent yes

Host snow prod-box
    HostName 192.168.1.50

Host *.example.com
    User deploy

Host !secret snow
    HostName 10.0.0.1

Host fileserver
    HostName 10.0.0.5
`);
    expect(listHostAliases(config)).toEqual(["fileserver", "prod-box", "snow"]);
  });

  it("returns an empty list when no hosts are defined", () => {
    expect(listHostAliases(parse(""))).toEqual([]);
  });
});
