import { promises as fs } from "node:fs";
import path from "node:path";

export type ServiceStatus = "active" | "paused" | "deprecated";

export type ProviderRecord = {
  id: string;
  name: string;
  description: string;
  website?: string;
  status: ServiceStatus;
  routing: {
    baseUrl: string;
    servicePath: string;
    authSecretRef?: string;
  };
};

export type ServiceRecord = {
  id: string;
  providerId: string;
  name: string;
  description: string;
  capabilities: string[];
  pricing: {
    currency: "USD";
    pricePerUnit: string;
    gatewayFeePercent: string;
  };
  meteringUnit: string;
  status: ServiceStatus;
  input: {
    contentTypes: string[];
    schemaSummary: string;
    required: string[];
  };
  output: {
    contentTypes: string[];
    streamEvents: string[];
  };
};

export type RegistryData = {
  providers: ProviderRecord[];
  services: ServiceRecord[];
};

export type PublicService = Omit<ServiceRecord, "providerId"> & {
  provider: {
    id: string;
    name: string;
    description: string;
    website?: string;
    status: ServiceStatus;
  };
};

const registryPath = path.join(process.cwd(), "data", "registry.json");

export async function readRegistry(): Promise<RegistryData> {
  const file = await fs.readFile(registryPath, "utf8");
  return JSON.parse(file) as RegistryData;
}

export async function listActiveServices(): Promise<PublicService[]> {
  const registry = await readRegistry();
  return registry.services
    .filter((service) => service.status === "active")
    .map((service) => toPublicService(service, registry))
    .filter(Boolean) as PublicService[];
}

export async function getPublicService(serviceId: string): Promise<PublicService | null> {
  const registry = await readRegistry();
  const service = registry.services.find((entry) => entry.id === serviceId && entry.status === "active");
  return service ? toPublicService(service, registry) : null;
}

export async function getServiceForSession(serviceId: string): Promise<{
  service: ServiceRecord;
  provider: ProviderRecord;
} | null> {
  const registry = await readRegistry();
  const service = registry.services.find((entry) => entry.id === serviceId && entry.status === "active");
  if (!service) return null;

  const provider = registry.providers.find((entry) => entry.id === service.providerId && entry.status === "active");
  if (!provider) return null;

  return { service, provider };
}

function toPublicService(service: ServiceRecord, registry: RegistryData): PublicService | null {
  const provider = registry.providers.find((entry) => entry.id === service.providerId);
  if (!provider) return null;

  const { routing: _routing, ...publicProvider } = provider;
  const { providerId: _providerId, ...publicService } = service;
  return {
    ...publicService,
    provider: publicProvider,
  };
}
