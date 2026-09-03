import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Regression test for a security-audit finding: the 'auth' socket event
 * used to trust a client-supplied `userId` with no server-side identity
 * check, letting any connected socket join `user:<victim id>` and receive
 * that user's real-time events (including payment_event) by simply
 * claiming their id. See FINAL_SECURITY_AUDIT_REPORT.md.
 */
describe('RealtimeGateway — socket identity spoofing', () => {
  let gateway: RealtimeGateway;
  let jwtService: { verify: jest.Mock };

  const makeClient = (cookieHeader?: string) => {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    return {
      id: 'socket-1',
      handshake: { headers: { cookie: cookieHeader } },
      data: {} as Record<string, unknown>,
      rooms: new Set<string>(),
      join: jest.fn(function (this: any, room: string) {
        this.rooms.add(room);
      }),
      leave: jest.fn(),
      emit: jest.fn((event: string, payload: unknown) => {
        emitted.push({ event, payload });
      }),
      _emitted: emitted,
    } as any;
  };

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    gateway = new RealtimeGateway(jwtService as unknown as JwtService);
  });

  it('refuses to join a room for a userId that does not match the verified session', () => {
    jwtService.verify.mockReturnValue({ sub: '1' }); // the real, authenticated user
    const client = makeClient('access_token=real-token-for-user-1');

    gateway.handleConnection(client);
    // Attacker claims to be user "2" (someone else) in the auth payload.
    gateway.auth(client, { userId: '2', deviceId: 'attacker-device' });

    expect(client.join).not.toHaveBeenCalledWith('user:2');
    expect(client._emitted).toContainEqual({
      event: 'socket_authenticated',
      payload: { success: false },
    });
  });

  it('joins the room only for the userId proven by the access_token cookie', () => {
    jwtService.verify.mockReturnValue({ sub: '1' });
    const client = makeClient('access_token=real-token-for-user-1');

    gateway.handleConnection(client);
    gateway.auth(client, { userId: '1', deviceId: 'device-a' });

    expect(client.join).toHaveBeenCalledWith('user:1');
    expect(client.join).toHaveBeenCalledWith('device:device-a');
  });

  it('refuses any room join when there is no valid access_token cookie at all', () => {
    const client = makeClient(undefined);

    gateway.handleConnection(client);
    gateway.auth(client, { userId: '1', deviceId: 'device-a' });

    expect(client.join).not.toHaveBeenCalled();
  });
});
