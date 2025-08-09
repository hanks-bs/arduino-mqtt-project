import { PORT } from 'config/config';
import 'reflect-metadata';
import app from './server';

export const main = async () => {
  const port = PORT || 3000;
  try {
    app.listen(port, () => {
      console.log(`Now listening on port ${port}`);
    });
  } catch (err) {
    console.error(err);
  }
};

main();
