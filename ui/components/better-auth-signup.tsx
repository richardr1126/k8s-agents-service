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
import { Loader2, X } from "lucide-react";
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
	const router = useRouter();
	const [loading, setLoading] = useState(false);

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
		<Card className="max-w-md">
			<CardHeader>
				<CardTitle className="text-lg md:text-xl">Sign Up</CardTitle>
				<CardDescription className="text-xs md:text-sm">
					Enter your information to create an account
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid gap-4">
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
							/>
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
							/>
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
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="password">Password</Label>
						<Input
							id="password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							autoComplete="new-password"
							placeholder="Password"
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="password_confirmation">Confirm Password</Label>
						<Input
							id="password_confirmation"
							type="password"
							value={passwordConfirmation}
							onChange={(e) => setPasswordConfirmation(e.target.value)}
							autoComplete="new-password"
							placeholder="Confirm Password"
						/>
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
						onClick={async () => {
							if (password !== passwordConfirmation) {
								toast.error("Passwords do not match");
								return;
							}

							try {
								// First, create the account
								await signUp.email({
									email,
									password,
									name: `${firstName} ${lastName}`,
									image: image ? await convertImageToBase64(image) : "",
									fetchOptions: {
										onResponse: () => {
											setLoading(false);
										},
										onRequest: () => {
											setLoading(true);
										},
										onError: (ctx) => {
											toast.error(ctx.error.message);
										},
									},
								});

								// If signup successful, automatically sign in
								await signIn.email({
									email,
									password,
								}, {
									onSuccess: () => {
										toast.success("Account created and signed in successfully!");
										router.push("/");
									},
									onError: () => {
										toast.success("Account created! Please sign in.");
										router.push("/signin");
									}
								});
							} catch (error) {
								console.error("Signup error:", error);
								toast.error("Failed to create account");
							}
						}}
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