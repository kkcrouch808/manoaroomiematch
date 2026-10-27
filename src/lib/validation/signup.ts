import * as Yup from 'yup';

export type SignUpForm = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  // acceptTerms: boolean;
};

/** Validation rules for the sign-up page (used with react-hook-form via yupResolver). */
export const signUpSchema = Yup.object().shape({
  firstName: Yup.string().required('First Name is required'),
  lastName: Yup.string().required('Last Name is required'),
  email: Yup.string()
    .required('Email is required')
    .email('Email is invalid')
    .test('is-hawaii-edu', 'Only @hawaii.edu emails are allowed', (value) => {
      if (!value) return false;
      return value.toLowerCase().endsWith('@hawaii.edu');
    }),
  password: Yup.string()
    .required('Password is required')
    .min(6, 'Password must be at least 6 characters')
    .max(40, 'Password must not exceed 40 characters'),
  confirmPassword: Yup.string()
    .required('Confirm Password is required')
    .oneOf([Yup.ref('password'), ''], 'Confirm Password does not match'),
});
