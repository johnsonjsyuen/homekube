import { connect, type NatsConnection, type JetStreamClient, JSONCodec } from "nats";

const DEFAULT_NATS_URL = "nats://192.168.8.209:4222";

export interface NatsContext {
  nc: NatsConnection;
  js: JetStreamClient;
  codec: ReturnType<typeof JSONCodec>;
}

export async function connectNats(): Promise<NatsContext> {
  const url = process.env.NATS_URL ?? DEFAULT_NATS_URL;

  const nc = await connect({ servers: url });
  console.log(`Connected to NATS at ${url}`);

  const js = nc.jetstream();
  const codec = JSONCodec();

  return { nc, js, codec };
}
