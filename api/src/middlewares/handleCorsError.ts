import { NextFunction, Response, Request } from 'express';

const handleCorsError = (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (err.message === 'Not allowed by CORS') {
        res.status(403).json({
            code: 'NOT_ALLOWED_BY_CORS',
            message:
                'Access forbidden: CORS policy does not allow access from this origin.',
        });
    } else {
        // Pass the error to the next middleware if it's not a CORS error
        next(err);
    }
};

export default handleCorsError;
