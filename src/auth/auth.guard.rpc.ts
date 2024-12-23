import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { Inject } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Define the gRPC interfaces for the AuthService and VerifyToken request/response
interface AuthServiceClient {
  verifyToken(request: { token: string }): Observable<{ username: string, role: string, userId: number }>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private authService: AuthServiceClient;
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    @Inject('AUTH_PACKAGE') private readonly client: ClientGrpc, // Inject gRPC client
  ) {}

  onModuleInit() {
    // Get the AuthService instance from the gRPC client
    this.authService = this.client.getService<AuthServiceClient>('AuthService');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authSwitch = process.env.AUTH_SWITCH;

    if (authSwitch === 'OFF') {
      this.logger.warn('Authentication is turned OFF. Allowing all requests.');
      return true; // Bypass authentication
    }

    if (authSwitch !== 'ON') {
      this.logger.error(`Invalid value for AUTH_SWITCH: ${authSwitch}. Use "ON" or "OFF".`);
      throw new Error('Invalid AUTH_SWITCH configuration'); // Fail-safe in case of misconfiguration
    }

    const request = context.switchToHttp().getRequest();
    const token = request.headers['authorization']?.split(' ')[1]; // Extract token from Authorization header

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    // Call gRPC method verifyToken
    try {
      const response = await lastValueFrom(this.authService.verifyToken({ token }));

      // Attach user information to the request
      request.user = {
        username: response.username,
        role: response.role,
        userId: response.userId,
      };

      return true;
    } catch (error) {
      this.logger.error('Invalid or expired token', error.stack); // Log error on failure
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}