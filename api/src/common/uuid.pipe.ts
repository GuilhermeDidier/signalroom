import { NotFoundException, PipeTransform } from '@nestjs/common';
import { UUID_RE } from './types';

/** Path ids that aren't UUIDs can't exist: answer 404 instead of a Postgres cast error. */
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_RE.test(value)) throw new NotFoundException();
    return value;
  }
}
