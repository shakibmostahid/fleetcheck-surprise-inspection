import { HttpStatus } from '@nestjs/common';
import { ApiResponse } from './api-response';
import { ResponseHandler } from './response-handler';

describe('ResponseHandler', () => {
  it('builds an ApiResponse with the status code and data', () => {
    const response = ResponseHandler.json(HttpStatus.CREATED, { id: 1 });

    expect(response).toBeInstanceOf(ApiResponse);
    expect(response).toEqual({ statusCode: 201, data: { id: 1 }, headers: {} });
  });

  it('keeps extra headers', () => {
    const response = ResponseHandler.json(HttpStatus.OK, {}, { 'Cache-Control': 'no-store' });

    expect(response.headers).toEqual({ 'Cache-Control': 'no-store' });
  });
});
