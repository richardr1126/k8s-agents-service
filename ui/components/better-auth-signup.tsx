"use client";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Loader2, X, AlertTriangle, CheckCircle, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { signUp, signIn } from "@/lib/auth-client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { showPrivacyPopup } from "@/components/privacy-popup";

export default function SignUp() {
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [passwordConfirmation, setPasswordConfirmation] = useState("");
	const [image, setImage] = useState<File | null>(null);
	const [imagePreview, setImagePreview] = useState<string | null>(null);
	const [showPassword, setShowPassword] = useState(false);
	const [showPasswordConfirmation, setShowPasswordConfirmation] = useState(false);
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [validationErrors, setValidationErrors] = useState<{
		firstName?: string;
		lastName?: string;
		email?: string;
		password?: string;
		passwordConfirmation?: string;
	}>({});

	// Password strength validation
	const validatePassword = (password: string) => {
		const checks = {
			length: password.length >= 8,
			uppercase: /[A-Z]/.test(password),
			lowercase: /[a-z]/.test(password),
			number: /\d/.test(password),
			special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
		};
		
		const strength = Object.values(checks).filter(Boolean).length;
		return { checks, strength };
	};

	// Email validation
	const validateEmail = (email: string): boolean => {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	};

	// Form validation
	const validateForm = (): boolean => {
		const errors: typeof validationErrors = {};
		
		if (!firstName.trim()) {
			errors.firstName = "First name is required";
		} else if (firstName.trim().length < 2) {
			errors.firstName = "First name must be at least 2 characters";
		}
		
		if (!lastName.trim()) {
			errors.lastName = "Last name is required";
		} else if (lastName.trim().length < 2) {
			errors.lastName = "Last name must be at least 2 characters";
		}
		
		if (!email.trim()) {
			errors.email = "Email is required";
		} else if (!validateEmail(email)) {
			errors.email = "Please enter a valid email address";
		}
		
		if (!password) {
			errors.password = "Password is required";
		} else {
			const { strength } = validatePassword(password);
			if (strength < 3) {
				errors.password = "Password is too weak. Include uppercase, lowercase, number, and special character";
			}
		}
		
		if (!passwordConfirmation) {
			errors.passwordConfirmation = "Please confirm your password";
		} else if (password !== passwordConfirmation) {
			errors.passwordConfirmation = "Passwords do not match";
		}
		
		setValidationErrors(errors);
		return Object.keys(errors).length === 0;
	};

	const handleSignUp = async () => {
		// Clear previous errors
		setError(null);
		setValidationErrors({});
		
		// Validate form
		if (!validateForm()) {
			return;
		}

		setLoading(true);
		
		try {
			const result = await signUp.email({
				email: email.trim(),
				password,
				name: `${firstName.trim()} ${lastName.trim()}`,
				image: image ? await convertImageToBase64(image) : "",
			});

			if (result.error) {
				// Handle signup errors
				const errorMessage = result.error.message || "An unknown error occurred";
				
				if (errorMessage.toLowerCase().includes("already exists") ||
					errorMessage.toLowerCase().includes("email already") ||
					errorMessage.toLowerCase().includes("user already")) {
					setError("An account with this email already exists. Please use a different email or try signing in.");
				} else if (errorMessage.toLowerCase().includes("invalid email")) {
					setError("Please enter a valid email address.");
				} else if (errorMessage.toLowerCase().includes("password")) {
					setError("Password does not meet security requirements. Please choose a stronger password.");
				} else {
					setError(errorMessage);
				}
			} else {
				// Success - automatically sign in
				const signInResult = await signIn.email({
					email: email.trim(),
					password,
				});

				if (signInResult.error) {
					toast.success("Account created successfully! Please sign in.");
					router.push("/signin");
				} else {
					toast.success("Account created and signed in successfully!");
					router.push("/");
				}
			}
		} catch (err) {
			console.error("Signup error:", err);
			setError("Unable to connect to the server. Please check your internet connection and try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			setImage(file);
			const reader = new FileReader();
			reader.onloadend = () => {
				setImagePreview(reader.result as string);
			};
			reader.readAsDataURL(file);
		}
	};

	return (
		<Card className="w-full max-w-md md:w-[480px]">
			<CardHeader>
				<motion.div
					animate={{ y: 0 }}
					transition={{ duration: 0.3, ease: "easeInOut" }}
				>
					<CardTitle className="text-lg md:text-xl">Sign Up</CardTitle>
					<CardDescription className="text-xs md:text-sm">
						Enter your information to create an account
					</CardDescription>
				</motion.div>
			</CardHeader>
			<CardContent>
				<div className="grid gap-4">
					{/* Animated error alert */}
					<AnimatePresence>
						{error && (
							<motion.div
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: "auto" }}
								exit={{ opacity: 0, height: 0 }}
								transition={{ duration: 0.3, ease: "easeInOut" }}
								className="overflow-hidden"
							>
								<div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md dark:bg-red-950 dark:border-red-800">
									<AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
									<div className="flex-1 text-sm text-red-700 dark:text-red-300">
										{error}
									</div>
								</div>
							</motion.div>
						)}
					</AnimatePresence>

					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="first-name">First name</Label>
							<Input
								id="first-name"
								placeholder="Richard"
								required
								onChange={(e) => {
									setFirstName(e.target.value);
								}}
								value={firstName}
								className={validationErrors.firstName ? "border-red-500" : ""}
							/>
							{validationErrors.firstName && (
								<p className="text-sm text-red-600 dark:text-red-400">
									{validationErrors.firstName}
								</p>
							)}
						</div>
						<div className="grid gap-2">
							<Label htmlFor="last-name">Last name</Label>
							<Input
								id="last-name"
								placeholder="Roberson"
								required
								onChange={(e) => {
									setLastName(e.target.value);
								}}
								value={lastName}
								className={validationErrors.lastName ? "border-red-500" : ""}
							/>
							{validationErrors.lastName && (
								<p className="text-sm text-red-600 dark:text-red-400">
									{validationErrors.lastName}
								</p>
							)}
						</div>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="email">Email</Label>
						<Input
							id="email"
							type="email"
							placeholder="me@example.com"
							required
							onChange={(e) => {
								setEmail(e.target.value);
							}}
							value={email}
							className={validationErrors.email ? "border-red-500" : ""}
						/>
						{validationErrors.email && (
							<p className="text-sm text-red-600 dark:text-red-400">
								{validationErrors.email}
							</p>
						)}
					</div>
					<div className="grid gap-2">
						<Label htmlFor="password">Password</Label>
						<div className="relative">
							<Input
								id="password"
								type={showPassword ? "text" : "password"}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								autoComplete="new-password"
								placeholder="Password"
								className={validationErrors.password ? "border-red-500 pr-10" : "pr-10"}
							/>
							<button
								type="button"
								className="absolute inset-y-0 right-0 pr-3 flex items-center"
								onClick={() => setShowPassword(!showPassword)}
							>
								{showPassword ? (
									<EyeOff className="h-4 w-4 text-gray-400" />
								) : (
									<Eye className="h-4 w-4 text-gray-400" />
								)}
							</button>
						</div>
						{password && (
							<div className="space-y-1">
								<p className="text-xs text-gray-600 dark:text-gray-400">Password strength:</p>
								{(() => {
									const { checks, strength } = validatePassword(password);
									const strengthLabels = ["Very Weak", "Weak", "Fair", "Good", "Strong"];
									const strengthColors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-blue-500", "bg-green-500"];
									
									return (
										<div className="space-y-1">
											<div className="flex space-x-1">
												{[0, 1, 2, 3, 4].map((i) => (
													<div
														key={i}
														className={`h-1 flex-1 rounded ${
															i < strength ? strengthColors[strength - 1] : "bg-gray-200 dark:bg-gray-700"
														}`}
													/>
												))}
											</div>
											<p className={`text-xs ${strength >= 3 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
												{strengthLabels[strength - 1] || "Very Weak"}
											</p>
											<div className="text-xs space-y-0.5">
												{Object.entries(checks).map(([key, passed]) => (
													<div key={key} className={`flex items-center gap-1 ${passed ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-gray-400"}`}>
														{passed ? <CheckCircle className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border border-current" />}
														<span>
															{key === "length" && "At least 8 characters"}
															{key === "uppercase" && "Uppercase letter"}
															{key === "lowercase" && "Lowercase letter"}
															{key === "number" && "Number"}
															{key === "special" && "Special character"}
														</span>
													</div>
												))}
											</div>
										</div>
									);
								})()}
							</div>
						)}
						{validationErrors.password && (
							<p className="text-sm text-red-600 dark:text-red-400">
								{validationErrors.password}
							</p>
						)}
					</div>
					<div className="grid gap-2">
						<Label htmlFor="password_confirmation">Confirm Password</Label>
						<div className="relative">
							<Input
								id="password_confirmation"
								type={showPasswordConfirmation ? "text" : "password"}
								value={passwordConfirmation}
								onChange={(e) => setPasswordConfirmation(e.target.value)}
								autoComplete="new-password"
								placeholder="Confirm Password"
								className={validationErrors.passwordConfirmation ? "border-red-500 pr-10" : "pr-10"}
							/>
							<button
								type="button"
								className="absolute inset-y-0 right-0 pr-3 flex items-center"
								onClick={() => setShowPasswordConfirmation(!showPasswordConfirmation)}
							>
								{showPasswordConfirmation ? (
									<EyeOff className="h-4 w-4 text-gray-400" />
								) : (
									<Eye className="h-4 w-4 text-gray-400" />
								)}
							</button>
						</div>
						{passwordConfirmation && password && (
							<div className={`flex items-center gap-1 text-xs ${
								password === passwordConfirmation 
									? "text-green-600 dark:text-green-400" 
									: "text-red-600 dark:text-red-400"
							}`}>
								{password === passwordConfirmation ? (
									<CheckCircle className="h-3 w-3" />
								) : (
									<AlertTriangle className="h-3 w-3" />
								)}
								<span>
									{password === passwordConfirmation ? "Passwords match" : "Passwords do not match"}
								</span>
							</div>
						)}
						{validationErrors.passwordConfirmation && (
							<p className="text-sm text-red-600 dark:text-red-400">
								{validationErrors.passwordConfirmation}
							</p>
						)}
					</div>
					<div className="grid gap-2">
						<Label htmlFor="image">Profile Image (optional)</Label>
						<div className="flex items-end gap-4">
							{imagePreview && (
								<div className="relative w-16 h-16 rounded-sm overflow-hidden">
									<Image
										src={imagePreview}
										alt="Profile preview"
										fill
										className="object-cover"
									/>
								</div>
							)}
							<div className="flex items-center gap-2 w-full">
								<Input
									id="image"
									type="file"
									accept="image/*"
									onChange={handleImageChange}
									className="w-full"
								/>
								{imagePreview && (
									<X
										className="cursor-pointer"
										onClick={() => {
											setImage(null);
											setImagePreview(null);
										}}
									/>
								)}
							</div>
						</div>
					</div>
					<Button
						type="submit"
						className="w-full"
						disabled={loading}
						onClick={handleSignUp}
					>
						{loading ? (
							<Loader2 size={16} className="animate-spin" />
						) : (
							"Create an account"
						)}
					</Button>
				</div>
			</CardContent>
			<CardFooter>
				<div className="flex flex-col items-center w-full border-t py-4 gap-2">
					<p className="text-center text-xs text-neutral-500">
						Already have an account?{" "}
						<Link
							href="/signin"
							className="underline"
						>
							<span className="dark:text-white/70 cursor-pointer">
								Sign in
							</span>
						</Link>
					</p>
					<p className="text-center text-xs text-neutral-500">
						By creating an account, you agree to our{" "}
						<button
							onClick={() => showPrivacyPopup()}
							className="underline hover:text-neutral-700 dark:hover:text-neutral-300"
						>
							Privacy Policy
						</button>
					</p>
				</div>
			</CardFooter>
		</Card>
	);
}

async function convertImageToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}